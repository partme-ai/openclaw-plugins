import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type {
  MemoryEmbeddingProbeResult,
  MemoryProviderStatus,
  MemorySearchManager,
  MemorySearchResult,
} from "openclaw/plugin-sdk/memory-core-host-engine-storage";

import type { MemoryConfig } from "./config.js";
import type { CapturedTurn, MemoryLevel, MemoryRecord } from "./model.js";
import { keywordScore } from "./text.js";

const SEARCH_DIRS = ["memories", "scenarios", "profiles"] as const;
const ALL_DIRS = ["conversations", ...SEARCH_DIRS] as const;

type EncryptedEnvelope = { v: 1; iv: string; tag: string; data: string };

function agentSegment(agentId: string): string {
  const readable = agentId.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "agent";
  const digest = createHash("sha256").update(agentId).digest("hex").slice(0, 12);
  return `${readable}-${digest}`;
}

function dateFile(now = new Date()): string {
  return `${now.toISOString().slice(0, 10)}.jsonl`;
}

function levelDir(level: MemoryLevel): (typeof ALL_DIRS)[number] {
  if (level === "L0") return "conversations";
  if (level === "L1") return "memories";
  if (level === "L2") return "scenarios";
  return "profiles";
}

class LineCodec {
  private readonly key?: Buffer;

  constructor(secret?: string) {
    this.key = secret ? createHash("sha256").update(secret).digest() : undefined;
  }

  encode(value: unknown): string {
    const plain = JSON.stringify(value);
    if (!this.key) return plain;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const envelope: EncryptedEnvelope = {
      v: 1,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: data.toString("base64"),
    };
    return JSON.stringify(envelope);
  }

  decode(line: string): unknown {
    const parsed = JSON.parse(line) as unknown;
    if (!this.key || !this.isEnvelope(parsed)) return parsed;
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(parsed.iv, "base64"));
    decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(parsed.data, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plain) as unknown;
  }

  private isEnvelope(value: unknown): value is EncryptedEnvelope {
    if (!value || typeof value !== "object") return false;
    const item = value as Partial<EncryptedEnvelope>;
    return item.v === 1 && typeof item.iv === "string" && typeof item.tag === "string" && typeof item.data === "string";
  }
}

export class MemoryStore {
  private readonly codec: LineCodec;
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly seenRunIds = new Set<string>();
  private readonly knownFiles = new Set<string>();
  private closed = false;

  constructor(private readonly config: MemoryConfig) {
    const secret = config.encryptionKeyEnv ? process.env[config.encryptionKeyEnv] : undefined;
    this.codec = new LineCodec(secret);
  }

  async initialize(): Promise<void> {
    await fs.mkdir(path.join(this.config.dataDir, "agents"), { recursive: true, mode: 0o700 });
    await fs.chmod(this.config.dataDir, 0o700).catch(() => undefined);
  }

  async appendTurn(turn: CapturedTurn): Promise<boolean> {
    this.ensureOpen();
    const filePath = this.filePath(turn.agentId, "conversations");
    return this.enqueue(filePath, async () => {
      if (turn.runId && (this.seenRunIds.has(turn.runId) || await this.hasRecentRunId(turn.agentId, turn.runId))) return false;
      await this.appendLine(filePath, turn);
      if (turn.runId) this.seenRunIds.add(turn.runId);
      return true;
    });
  }

  async appendRecords(records: MemoryRecord[]): Promise<void> {
    this.ensureOpen();
    const grouped = new Map<string, MemoryRecord[]>();
    for (const record of records) {
      const filePath = this.filePath(record.agentId, levelDir(record.level));
      grouped.set(filePath, [...(grouped.get(filePath) ?? []), record]);
    }
    await Promise.all([...grouped].map(([filePath, values]) => this.enqueue(filePath, async () => {
      await this.ensureParent(filePath);
      const payload = values.map((value) => this.codec.encode(value)).join("\n") + "\n";
      await fs.appendFile(filePath, payload, { encoding: "utf8", mode: 0o600 });
      this.knownFiles.add(filePath);
    })));
  }

  createSearchManager(agentId: string): MemorySearchManager {
    return {
      search: async (query, opts) => this.search(agentId, query, opts),
      readFile: async (params) => this.readFile(agentId, params.relPath, params.from, params.lines),
      status: () => this.status(agentId),
      sync: async () => { await this.cleanup(); },
      probeEmbeddingAvailability: async (): Promise<MemoryEmbeddingProbeResult> => ({
        ok: false,
        checked: true,
        checkedAtMs: Date.now(),
        error: "local lexical search does not use embeddings",
      }),
      probeVectorAvailability: async () => false,
      close: async () => { await this.drain(); },
    };
  }

  async cleanup(now = Date.now()): Promise<number> {
    this.ensureOpen();
    const cutoff = now - this.config.retentionDays * 24 * 60 * 60 * 1000;
    let removed = 0;
    const agentsDir = path.join(this.config.dataDir, "agents");
    for (const agent of await this.safeReadDir(agentsDir)) {
      if (!agent.isDirectory()) continue;
      for (const dirName of ALL_DIRS) {
        const dir = path.join(agentsDir, agent.name, dirName);
        for (const entry of await this.safeReadDir(dir)) {
          if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
          const filePath = path.join(dir, entry.name);
          const date = Date.parse(entry.name.slice(0, 10));
          const timestamp = Number.isFinite(date) ? date : (await fs.stat(filePath)).mtimeMs;
          if (timestamp < cutoff) {
            await this.enqueue(filePath, async () => { await fs.rm(filePath, { force: true }); });
            this.knownFiles.delete(filePath);
            removed += 1;
          }
        }
      }
    }
    return removed;
  }

  async close(): Promise<void> {
    await this.drain();
    this.closed = true;
    this.seenRunIds.clear();
  }

  private async search(
    agentId: string,
    query: string,
    opts?: { maxResults?: number; minScore?: number; sessionKey?: string; signal?: AbortSignal },
  ): Promise<MemorySearchResult[]> {
    this.ensureOpen();
    const maxResults = Math.min(Math.max(opts?.maxResults ?? this.config.maxSearchResults, 1), 100);
    const minScore = Math.max(opts?.minScore ?? 0, 0);
    const root = this.agentRoot(agentId);
    const results: MemorySearchResult[] = [];
    for (const dirName of SEARCH_DIRS) {
      const dir = path.join(root, dirName);
      const files = (await this.safeReadDir(dir))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
        .map((entry) => entry.name)
        .sort()
        .reverse()
        .slice(0, Math.min(this.config.retentionDays, 365));
      for (const file of files) {
        opts?.signal?.throwIfAborted();
        const relPath = `${dirName}/${file}`;
        this.knownFiles.add(path.join(dir, file));
        const lines = await this.readDecodedLines(path.join(dir, file));
        lines.forEach((record, index) => {
          if (!this.isMemoryRecord(record)) return;
          const profileMayCrossSession = record.level === "L3" && this.config.profileScope === "agent";
          if (opts?.sessionKey && record.sessionKey !== opts.sessionKey && !profileMayCrossSession) return;
          const score = keywordScore(query, record.content, record.keywords);
          if (score <= 0 || score < minScore) return;
          results.push({
            path: relPath,
            startLine: index + 1,
            endLine: index + 1,
            score,
            textScore: score,
            snippet: `[${record.level}/${record.type}] ${record.content}`.slice(0, 500),
            source: "memory",
            citation: `${relPath}#L${index + 1}`,
          });
        });
      }
    }
    return results.sort((left, right) => right.score - left.score).slice(0, maxResults);
  }

  private async readFile(agentId: string, relPath: string, from?: number, lines?: number) {
    const root = this.agentRoot(agentId);
    const filePath = path.resolve(root, relPath);
    if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
      throw new Error("[memory] refusing to read outside the agent memory directory");
    }
    const allowed = SEARCH_DIRS.some((dir) => filePath.startsWith(`${path.join(root, dir)}${path.sep}`));
    if (!allowed) throw new Error("[memory] only searchable memory files may be read");
    const decoded = await this.readDecodedLines(filePath);
    const start = Math.max(0, from ?? 0);
    const selected = decoded.slice(start, lines == null ? decoded.length : start + Math.max(0, lines));
    return {
      text: selected.map((item) => JSON.stringify(item)).join("\n") + (selected.length ? "\n" : ""),
      path: relPath,
      from: start,
      lines: selected.length,
      truncated: start + selected.length < decoded.length,
      ...(start + selected.length < decoded.length ? { nextFrom: start + selected.length } : {}),
    };
  }

  private status(agentId: string): MemoryProviderStatus {
    return {
      backend: "builtin",
      provider: "local-lexical",
      files: [...this.knownFiles].filter((file) => file.startsWith(this.agentRoot(agentId))).length,
      workspaceDir: this.agentRoot(agentId),
      sources: ["memory"],
      vector: { enabled: false, semanticAvailable: false, available: false },
      custom: {
        encrypted: Boolean(this.config.encryptionKeyEnv),
        retentionDays: this.config.retentionDays,
        isolation: this.config.profileScope === "agent" ? "agent+session-with-agent-profiles" : "agent+session",
        profileScope: this.config.profileScope,
        pendingWrites: this.queues.size,
      },
    };
  }

  private agentRoot(agentId: string): string {
    return path.join(this.config.dataDir, "agents", agentSegment(agentId));
  }

  private filePath(agentId: string, dirName: (typeof ALL_DIRS)[number]): string {
    return path.join(this.agentRoot(agentId), dirName, dateFile());
  }

  private async appendLine(filePath: string, value: unknown): Promise<void> {
    const encoded = this.codec.encode(value);
    if (Buffer.byteLength(encoded) > this.config.maxRecordBytes) {
      throw new Error(`[memory] record exceeds maxRecordBytes (${this.config.maxRecordBytes})`);
    }
    await this.ensureParent(filePath);
    await fs.appendFile(filePath, `${encoded}\n`, { encoding: "utf8", mode: 0o600 });
    this.knownFiles.add(filePath);
  }

  private async ensureParent(filePath: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  }

  private async fileContainsRunId(filePath: string, runId: string): Promise<boolean> {
    const records = await this.readDecodedLines(filePath);
    return records.some((record) => Boolean(record && typeof record === "object" && (record as { runId?: unknown }).runId === runId));
  }

  private async hasRecentRunId(agentId: string, runId: string): Promise<boolean> {
    const dir = path.join(this.agentRoot(agentId), "conversations");
    const files = (await this.safeReadDir(dir))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => entry.name)
      .sort()
      .reverse()
      .slice(0, 2);
    for (const file of files) {
      if (await this.fileContainsRunId(path.join(dir, file), runId)) return true;
    }
    return false;
  }

  private async readDecodedLines(filePath: string): Promise<unknown[]> {
    try {
      const content = await fs.readFile(filePath, "utf8");
      const output: unknown[] = [];
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try { output.push(this.codec.decode(line)); } catch { /* corrupted or wrong-key lines are isolated */ }
      }
      return output;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async safeReadDir(dir: string): Promise<import("node:fs").Dirent[]> {
    try { return await fs.readdir(dir, { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private isMemoryRecord(value: unknown): value is MemoryRecord {
    if (!value || typeof value !== "object") return false;
    const record = value as Partial<MemoryRecord>;
    return typeof record.content === "string" && Array.isArray(record.keywords) && typeof record.level === "string";
  }

  private enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    this.queues.set(key, next);
    return next.finally(() => { if (this.queues.get(key) === next) this.queues.delete(key); }) as Promise<T>;
  }

  private async drain(): Promise<void> {
    await Promise.allSettled([...this.queues.values()]);
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error("[memory] store is closed");
  }
}
