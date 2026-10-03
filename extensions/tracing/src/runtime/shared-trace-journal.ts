/**
 * 按 OpenClaw profile 保存已完成 Span 的共享查询日志，供隔离的 Hook 与 HTTP runtime 使用。
 * SQLite BEGIN IMMEDIATE 串行化跨进程写入，并在崩溃后回滚未提交事务；HTTP 路由
 * 仅在 OpenClaw Gateway 完成鉴权后开放查询。
 */
import { chmod, lstat, mkdir, realpath } from "node:fs/promises";
import { resolve, join, relative, isAbsolute, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Span } from "../shared/types.js";
import { redactTraceText } from "../shared/redact.js";

const TRACE_ID = /^[a-f0-9]{32}$/;
const SPAN_ID = /^[a-f0-9]{16}$/;
const MAX_SPAN_BYTES = 8_192;
const DEFAULT_MAX_TRACES = 200;
const DEFAULT_MAX_SPANS = 100;
const IDENTIFIER_ATTRIBUTES = new Set([
  "openclaw.session_key", "openclaw.run_id", "openclaw.message_id", "openclaw.tool_call_id",
]);

export interface TraceSummary {
  traceId: string;
  spanCount: number;
  startTimeMs: number;
  endTimeMs?: number;
  rootSpan: string;
}

export class SharedTraceJournal {
  readonly directory: string;
  private readonly maxTraces: number;
  private readonly maxSpansPerTrace: number;
  private readonly retentionMs: number;
  private readonly scopeRoot: string | undefined;

  constructor(directory: string, options: {
    maxTraces?: number;
    maxSpansPerTrace?: number;
    retentionMs?: number;
    scopeRoot?: string;
  } = {}) {
    this.directory = resolve(directory);
    this.maxTraces = options.maxTraces ?? DEFAULT_MAX_TRACES;
    this.maxSpansPerTrace = options.maxSpansPerTrace ?? DEFAULT_MAX_SPANS;
    this.retentionMs = options.retentionMs ?? 7 * 86_400_000;
    this.scopeRoot = options.scopeRoot && resolve(options.scopeRoot);
    if (!Number.isInteger(this.maxTraces) || this.maxTraces < 1 || this.maxTraces > 200 ||
        !Number.isInteger(this.maxSpansPerTrace) || this.maxSpansPerTrace < 1 || this.maxSpansPerTrace > 100 ||
        !Number.isFinite(this.retentionMs) || this.retentionMs < 1) {
      throw new Error("invalid trace journal bounds");
    }
  }

  /** Open once at startup so SQLite can recover any interrupted transaction. */
  async prepare(): Promise<void> {
    await this.withWriteDatabase(() => undefined);
  }

  /** Persist one completed Span and enforce TTL and capacity in one transaction. */
  async writeSpan(span: Span): Promise<void> {
    this.validateTraceId(span.traceId);
    if (!SPAN_ID.test(span.spanId)) throw new Error("invalid spanId");
    const data = JSON.stringify(this.safeSpan(span));
    if (Buffer.byteLength(data) > MAX_SPAN_BYTES) throw new Error("trace journal span size capacity exceeded");
    await this.withWriteDatabase((db) => {
      this.expire(db);
      const trace = db.prepare("SELECT trace_id FROM traces WHERE trace_id = ?").get(span.traceId);
      if (!trace) {
        const total = db.prepare("SELECT COUNT(*) AS count FROM traces").get() as { count: number };
        if (total.count >= this.maxTraces) {
          const oldest = db.prepare("SELECT trace_id FROM traces ORDER BY updated_at ASC, trace_id ASC LIMIT 1").get() as { trace_id: string };
          db.prepare("DELETE FROM traces WHERE trace_id = ?").run(oldest.trace_id);
        }
        db.prepare("INSERT INTO traces(trace_id, updated_at, span_count, start_time_ms, end_time_ms, root_span) VALUES (?, ?, 0, 0, 0, '(unknown)')")
          .run(span.traceId, Date.now());
      }
      const previous = db.prepare("SELECT span_id FROM spans WHERE trace_id = ? AND span_id = ?").get(span.traceId, span.spanId);
      const count = db.prepare("SELECT COUNT(*) AS count FROM spans WHERE trace_id = ?").get(span.traceId) as { count: number };
      if (!previous && count.count >= this.maxSpansPerTrace) throw new Error("trace journal span capacity exceeded");
      db.prepare("INSERT INTO spans(trace_id, span_id, data, start_time_ms, end_time_ms, root_name) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(trace_id, span_id) DO UPDATE SET data=excluded.data, start_time_ms=excluded.start_time_ms, end_time_ms=excluded.end_time_ms, root_name=excluded.root_name")
        .run(span.traceId, span.spanId, data, span.startTimeMs, span.endTimeMs ?? span.startTimeMs, span.parentSpanId ? null : redactTraceText(span.name));
      const summary = db.prepare("SELECT COUNT(*) AS span_count, MIN(start_time_ms) AS start_time_ms, MAX(end_time_ms) AS end_time_ms FROM spans WHERE trace_id = ?").get(span.traceId) as { span_count: number; start_time_ms: number; end_time_ms: number };
      const root = db.prepare("SELECT root_name FROM spans WHERE trace_id = ? AND root_name IS NOT NULL ORDER BY start_time_ms LIMIT 1").get(span.traceId) as { root_name: string } | undefined;
      db.prepare("UPDATE traces SET updated_at = ?, span_count = ?, start_time_ms = ?, end_time_ms = ?, root_span = ? WHERE trace_id = ?")
        .run(Date.now(), summary.span_count, summary.start_time_ms, summary.end_time_ms, root?.root_name ?? "(unknown)", span.traceId);
    });
  }

  /** Count retained traces after TTL cleanup. */
  async count(): Promise<number> {
    return (await this.withReadDatabase((db) =>
      (db.prepare("SELECT COUNT(*) AS count FROM traces WHERE updated_at >= ?")
        .get(Date.now() - this.retentionMs) as { count: number }).count)) ?? 0;
  }

  /** Return at most 200 small summaries; no raw Span data is read. */
  async list(limit: number): Promise<TraceSummary[]> {
    return (await this.withReadDatabase((db) => {
      const safeLimit = Math.min(Math.max(1, Math.floor(limit)), this.maxTraces);
      const rows = db.prepare("SELECT trace_id, span_count, start_time_ms, end_time_ms, root_span FROM traces WHERE updated_at >= ? ORDER BY updated_at DESC, trace_id ASC LIMIT ?")
        .all(Date.now() - this.retentionMs, safeLimit) as Array<{ trace_id: string; span_count: number; start_time_ms: number; end_time_ms: number; root_span: string }>;
      return rows.map((row) => ({ traceId: row.trace_id, spanCount: row.span_count,
        startTimeMs: row.start_time_ms, endTimeMs: row.end_time_ms, rootSpan: row.root_span }));
    })) ?? [];
  }

  /** Return bounded Span detail for one validated trace ID. */
  async get(traceId: string): Promise<Span[] | undefined> {
    this.validateTraceId(traceId);
    return this.withReadDatabase((db) => {
      const rows = db.prepare("SELECT data FROM spans WHERE trace_id = ? AND EXISTS (SELECT 1 FROM traces WHERE trace_id = ? AND updated_at >= ?) ORDER BY start_time_ms ASC, span_id ASC LIMIT ?")
        .all(traceId, traceId, Date.now() - this.retentionMs, this.maxSpansPerTrace) as Array<{ data: string }>;
      if (!rows.length) return undefined;
      return rows.map((row) => {
        if (Buffer.byteLength(row.data) > MAX_SPAN_BYTES) throw new Error("oversized trace journal span");
        const parsed = JSON.parse(row.data) as Span;
        if (parsed.traceId !== traceId || !SPAN_ID.test(parsed.spanId) || !Array.isArray(parsed.events)) {
          throw new Error("invalid trace journal span");
        }
        return parsed;
      });
    });
  }

  private expire(db: DatabaseSync): void {
    db.prepare("DELETE FROM traces WHERE updated_at < ?").run(Date.now() - this.retentionMs);
  }

  private async locateDatabase(create: boolean): Promise<string | undefined> {
    if (this.scopeRoot) {
      const lexical = relative(this.scopeRoot, this.directory);
      if (lexical === ".." || lexical.startsWith(`..${sep}`) || isAbsolute(lexical)) {
        throw new Error("trace journal escaped the OpenClaw state directory");
      }
      if (create) await mkdir(this.scopeRoot, { recursive: true, mode: 0o700 });
      const base = await this.checkedStat(this.scopeRoot);
      if (!base) return undefined;
      if (!base.isDirectory() || base.isSymbolicLink()) throw new Error("unsafe trace journal state directory or symlink");
      let cursor = this.scopeRoot;
      for (const component of lexical.split(sep).filter(Boolean)) {
        cursor = join(cursor, component);
        if (create) {
          await mkdir(cursor, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "EEXIST") throw error;
          });
        }
        const entry = await this.checkedStat(cursor);
        if (!entry) return undefined;
        if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("unsafe trace journal parent directory or symlink");
      }
      const canonicalBase = await realpath(this.scopeRoot);
      const canonicalDirectory = await realpath(this.directory);
      const within = relative(canonicalBase, canonicalDirectory);
      if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) {
        throw new Error("trace journal escaped the OpenClaw state directory");
      }
    } else {
      if (create) await mkdir(this.directory, { recursive: true, mode: 0o700 });
    }
    const dir = await this.checkedStat(this.directory);
    if (!dir) return undefined;
    if (!dir.isDirectory() || dir.isSymbolicLink()) throw new Error("unsafe trace journal directory or symlink");
    if (create) await chmod(this.directory, 0o700);
    const file = join(this.directory, "journal.sqlite");
    const existing = await this.checkedStat(file);
    if (!existing && !create) return undefined;
    if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error("unsafe trace journal database or symlink");
    if (!create && existing && (Number(existing.mode) & 0o077) !== 0) throw new Error("trace journal database permissions are too broad");
    return file;
  }

  private async checkedStat(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
    try { return await lstat(path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  private async withReadDatabase<T>(action: (db: DatabaseSync) => T): Promise<T | undefined> {
    const file = await this.locateDatabase(false);
    if (!file) return undefined;
    const db = new DatabaseSync(file, { readOnly: true, timeout: 100 });
    try {
      db.exec("PRAGMA query_only=ON");
      return action(db);
    } finally {
      db.close();
    }
  }

  private async withWriteDatabase<T>(action: (db: DatabaseSync) => T): Promise<T> {
    const file = await this.locateDatabase(true);
    if (!file) throw new Error("trace journal directory unavailable");
    const db = new DatabaseSync(file, { timeout: 750 });
    try {
      await chmod(file, 0o600);
      db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON");
      db.exec("CREATE TABLE IF NOT EXISTS traces (trace_id TEXT PRIMARY KEY, updated_at INTEGER NOT NULL, span_count INTEGER NOT NULL, start_time_ms INTEGER NOT NULL, end_time_ms INTEGER NOT NULL, root_span TEXT NOT NULL)");
      db.exec("CREATE TABLE IF NOT EXISTS spans (trace_id TEXT NOT NULL REFERENCES traces(trace_id) ON DELETE CASCADE, span_id TEXT NOT NULL, data TEXT NOT NULL, start_time_ms INTEGER NOT NULL, end_time_ms INTEGER NOT NULL, root_name TEXT, PRIMARY KEY(trace_id, span_id))");
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = action(db);
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    } finally {
      db.close();
    }
  }

  private validateTraceId(traceId: string): void {
    if (!TRACE_ID.test(traceId)) throw new Error("traceId must be a lowercase 32 character hexadecimal ID");
  }

  private safeSpan(span: Span): Span {
    const safeAttributes = (attributes: Record<string, string | number | boolean> | undefined) =>
      attributes && Object.fromEntries(Object.entries(attributes).map(([key, value]) => {
        if (typeof value !== "string") return [key, value];
        if (IDENTIFIER_ATTRIBUTES.has(key)) {
          return [key, /^id_[a-f0-9]{24}$/.test(value) ? value : "[REDACTED]"];
        }
        return [key, redactTraceText(value)];
      }));
    return {
      ...span,
      name: redactTraceText(span.name),
      attributes: safeAttributes(span.attributes) ?? {},
      events: span.events.map((event) => ({ ...event, name: redactTraceText(event.name),
        attributes: safeAttributes(event.attributes) })),
    };
  }
}
