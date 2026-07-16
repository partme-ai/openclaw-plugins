import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
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
const ISOLATION_KEY_FILE = ".isolation-key";
const ENCRYPTION_CHECK_FILE = ".encryption-check";
const ENCRYPTION_CHECK_VALUE = "openclaw-memory-v1";
const SESSION_TOKEN_PATTERN = /^[a-f0-9]{32}$/;
const DATE_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

type MemoryDir = (typeof ALL_DIRS)[number];
type SearchDir = (typeof SEARCH_DIRS)[number];
type EncryptedEnvelope = { v: 1; iv: string; tag: string; data: string };

function agentSegment(agentId: string): string {
  const readable =
    agentId
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "agent";
  const digest = createHash("sha256").update(agentId).digest("hex").slice(0, 12);
  return `${readable}-${digest}`;
}

function dateFile(now = new Date()): string {
  return `${now.toISOString().slice(0, 10)}.jsonl`;
}

function levelDir(level: MemoryLevel): MemoryDir {
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
    if (!this.isEnvelope(parsed)) return parsed;
    if (!this.key) {
      throw new Error("encrypted memory requires the configured encryption key");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(parsed.iv, "base64"),
    );
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
    return (
      item.v === 1 &&
      typeof item.iv === "string" &&
      typeof item.tag === "string" &&
      typeof item.data === "string"
    );
  }
}

export class MemoryStore {
  private readonly codec: LineCodec;
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly seenRunIds = new Set<string>();
  private readonly knownFiles = new Set<string>();
  private isolationKey?: Buffer;
  private initialized = false;
  private closed = false;

  constructor(private readonly config: MemoryConfig) {
    const secret = config.encryptionKeyEnv ? process.env[config.encryptionKeyEnv] : undefined;
    this.codec = new LineCodec(secret);
  }

  async initialize(): Promise<void> {
    this.ensureOpen();
    await fs.mkdir(path.join(this.config.dataDir, "agents"), {
      recursive: true,
      mode: 0o700,
    });
    await fs.chmod(this.config.dataDir, 0o700).catch(() => undefined);
    this.isolationKey = await this.loadOrCreateIsolationKey();
    await this.verifyEncryptionKey();
    await this.migrateLegacyLayout();
    await this.discoverActiveFiles();
    this.initialized = true;
  }

  async appendTurn(turn: CapturedTurn): Promise<boolean> {
    this.ensureReady();
    const filePath = this.filePath(turn.agentId, turn.sessionKey, "conversations");
    const dedupeKey = `${turn.agentId}\u0000${turn.sessionKey}\u0000${turn.runId ?? ""}`;
    return this.enqueue(filePath, async () => {
      if (
        turn.runId &&
        (this.seenRunIds.has(dedupeKey) ||
          (await this.hasRecentRunId(turn.agentId, turn.sessionKey, turn.runId)))
      ) {
        return false;
      }
      await this.appendLine(filePath, turn);
      if (turn.runId) this.seenRunIds.add(dedupeKey);
      return true;
    });
  }

  async appendRecords(records: MemoryRecord[]): Promise<void> {
    this.ensureReady();
    const grouped = new Map<string, MemoryRecord[]>();
    for (const record of records) {
      const filePath = this.filePath(
        record.agentId,
        record.sessionKey,
        levelDir(record.level),
      );
      grouped.set(filePath, [...(grouped.get(filePath) ?? []), record]);
    }
    await Promise.all(
      [...grouped].map(([filePath, values]) =>
        this.enqueue(filePath, async () => {
          const encoded = values.map((value) => this.encodeChecked(value));
          await this.ensureParent(filePath);
          await fs.appendFile(filePath, `${encoded.join("\n")}\n`, {
            encoding: "utf8",
            mode: 0o600,
          });
          this.knownFiles.add(filePath);
        }),
      ),
    );
  }

  createSearchManager(agentId: string): MemorySearchManager {
    return {
      search: async (query, opts) => this.search(agentId, query, opts),
      readFile: async (params) =>
        this.readFile(agentId, params.relPath, params.from, params.lines),
      status: () => this.status(agentId),
      sync: async () => {
        await this.cleanup();
      },
      probeEmbeddingAvailability: async (): Promise<MemoryEmbeddingProbeResult> => ({
        ok: false,
        checked: true,
        checkedAtMs: Date.now(),
        error: "local lexical search does not use embeddings",
      }),
      probeVectorAvailability: async () => false,
      close: async () => {
        await this.drain();
      },
    };
  }

  async cleanup(now = Date.now()): Promise<number> {
    this.ensureReady();
    const cutoff = now - this.config.retentionDays * 24 * 60 * 60 * 1000;
    let removed = 0;
    const agentsDir = path.join(this.config.dataDir, "agents");
    for (const filePath of await this.listJsonlFiles(agentsDir)) {
      if (!this.isActiveFile(filePath)) continue;
      const fileName = path.basename(filePath);
      const date = Date.parse(fileName.slice(0, 10));
      const timestamp = Number.isFinite(date) ? date : (await fs.stat(filePath)).mtimeMs;
      if (timestamp >= cutoff) continue;
      await this.enqueue(filePath, async () => {
        await fs.rm(filePath, { force: true });
      });
      this.knownFiles.delete(filePath);
      removed += 1;
    }
    return removed;
  }

  async close(): Promise<void> {
    await this.drain();
    this.closed = true;
    this.initialized = false;
    this.seenRunIds.clear();
    this.isolationKey = undefined;
  }

  private async search(
    agentId: string,
    query: string,
    opts?: {
      maxResults?: number;
      minScore?: number;
      sessionKey?: string;
      signal?: AbortSignal;
    },
  ): Promise<MemorySearchResult[]> {
    this.ensureReady();
    const maxResults = Math.min(
      Math.max(opts?.maxResults ?? this.config.maxSearchResults, 1),
      100,
    );
    const minScore = Math.max(opts?.minScore ?? 0, 0);
    const root = this.agentRoot(agentId);
    const sessionKey = opts?.sessionKey?.trim();
    const searchRoots: Array<{ dir: string; relDir: string }> = [];

    if (sessionKey) {
      const token = this.sessionToken(sessionKey);
      for (const dirName of SEARCH_DIRS) {
        if (dirName === "profiles" && this.config.profileScope === "agent") continue;
        searchRoots.push({
          dir: path.join(root, "sessions", token, dirName),
          relDir: `sessions/${token}/${dirName}`,
        });
      }
    }
    if (this.config.profileScope === "agent") {
      searchRoots.push({
        dir: path.join(root, "agent-profiles"),
        relDir: "agent-profiles",
      });
    }

    const results: MemorySearchResult[] = [];
    for (const searchRoot of searchRoots) {
      const files = (await this.safeReadDir(searchRoot.dir))
        .filter((entry) => entry.isFile() && DATE_FILE_PATTERN.test(entry.name))
        .map((entry) => entry.name)
        .sort()
        .reverse()
        .slice(0, Math.min(this.config.retentionDays, 365));
      for (const file of files) {
        opts?.signal?.throwIfAborted();
        const relPath = `${searchRoot.relDir}/${file}`;
        const absolutePath = path.join(searchRoot.dir, file);
        this.knownFiles.add(absolutePath);
        const records = await this.readDecodedLines(absolutePath);
        records.forEach((record, index) => {
          if (!this.isMemoryRecord(record)) return;
          const profileMayCrossSession =
            record.level === "L3" && this.config.profileScope === "agent";
          if (sessionKey && record.sessionKey !== sessionKey && !profileMayCrossSession) return;
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
    this.ensureReady();
    const root = this.agentRoot(agentId);
    const filePath = path.resolve(root, relPath);
    if (!filePath.startsWith(`${root}${path.sep}`)) {
      throw new Error("[memory] refusing to read outside the agent memory directory");
    }
    if (!this.isReadableRelPath(relPath)) {
      throw new Error("[memory] only session-capability or agent-profile memory files may be read");
    }
    const decoded = await this.readDecodedLines(filePath);
    const start = Math.max(0, from ?? 0);
    const selected = decoded.slice(
      start,
      lines == null ? decoded.length : start + Math.max(0, lines),
    );
    return {
      text: selected.map((item) => JSON.stringify(item)).join("\n") + (selected.length ? "\n" : ""),
      path: relPath,
      from: start,
      lines: selected.length,
      truncated: start + selected.length < decoded.length,
      ...(start + selected.length < decoded.length
        ? { nextFrom: start + selected.length }
        : {}),
    };
  }

  private status(agentId: string): MemoryProviderStatus {
    return {
      backend: "builtin",
      provider: "local-lexical",
      files: [...this.knownFiles].filter((file) =>
        file.startsWith(`${this.agentRoot(agentId)}${path.sep}`),
      ).length,
      workspaceDir: this.agentRoot(agentId),
      sources: ["memory"],
      vector: { enabled: false, semanticAvailable: false, available: false },
      custom: {
        encrypted: Boolean(this.config.encryptionKeyEnv),
        retentionDays: this.config.retentionDays,
        isolation:
          this.config.profileScope === "agent"
            ? "agent+physical-session-with-agent-profiles"
            : "agent+physical-session",
        profileScope: this.config.profileScope,
        pendingWrites: this.queues.size,
      },
    };
  }

  private agentRoot(agentId: string): string {
    return path.join(this.config.dataDir, "agents", agentSegment(agentId));
  }

  private filePath(agentId: string, sessionKey: string, dirName: MemoryDir): string {
    const root = this.agentRoot(agentId);
    if (dirName === "profiles" && this.config.profileScope === "agent") {
      return path.join(root, "agent-profiles", dateFile());
    }
    return path.join(root, "sessions", this.sessionToken(sessionKey), dirName, dateFile());
  }

  private sessionToken(sessionKey: string): string {
    if (!this.isolationKey) throw new Error("[memory] store is not initialized");
    return createHmac("sha256", this.isolationKey)
      .update(sessionKey)
      .digest("hex")
      .slice(0, 32);
  }

  private isReadableRelPath(relPath: string): boolean {
    if (path.isAbsolute(relPath) || relPath.includes("\\")) return false;
    const segments = relPath.split("/");
    if (
      this.config.profileScope === "agent" &&
      segments.length === 2 &&
      segments[0] === "agent-profiles" &&
      DATE_FILE_PATTERN.test(segments[1] ?? "")
    ) {
      return true;
    }
    return (
      segments.length === 4 &&
      segments[0] === "sessions" &&
      SESSION_TOKEN_PATTERN.test(segments[1] ?? "") &&
      SEARCH_DIRS.includes((segments[2] ?? "") as SearchDir) &&
      !(segments[2] === "profiles" && this.config.profileScope === "agent") &&
      DATE_FILE_PATTERN.test(segments[3] ?? "")
    );
  }

  private encodeChecked(value: unknown): string {
    const encoded = this.codec.encode(value);
    if (Buffer.byteLength(encoded) > this.config.maxRecordBytes) {
      throw new Error(`[memory] record exceeds maxRecordBytes (${this.config.maxRecordBytes})`);
    }
    return encoded;
  }

  private async appendLine(filePath: string, value: unknown): Promise<void> {
    const encoded = this.encodeChecked(value);
    await this.ensureParent(filePath);
    await fs.appendFile(filePath, `${encoded}\n`, { encoding: "utf8", mode: 0o600 });
    this.knownFiles.add(filePath);
  }

  private async ensureParent(filePath: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  }

  private async hasRecentRunId(
    agentId: string,
    sessionKey: string,
    runId: string,
  ): Promise<boolean> {
    const dir = path.dirname(this.filePath(agentId, sessionKey, "conversations"));
    const files = (await this.safeReadDir(dir))
      .filter((entry) => entry.isFile() && DATE_FILE_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .reverse()
      .slice(0, 2);
    for (const file of files) {
      const records = await this.readDecodedLines(path.join(dir, file));
      if (
        records.some(
          (record) =>
            Boolean(record) &&
            typeof record === "object" &&
            (record as { runId?: unknown }).runId === runId,
        )
      ) {
        return true;
      }
    }
    return false;
  }

  private async readDecodedLines(filePath: string): Promise<unknown[]> {
    try {
      const content = await fs.readFile(filePath, "utf8");
      const output: unknown[] = [];
      let lineNumber = 0;
      for (const line of content.split("\n")) {
        lineNumber += 1;
        if (!line.trim()) continue;
        try {
          output.push(this.codec.decode(line));
        } catch (error) {
          throw new Error(
            `[memory] cannot decode ${filePath}:${lineNumber}; data is corrupt or the encryption key is wrong`,
            { cause: error },
          );
        }
      }
      return output;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async loadOrCreateIsolationKey(): Promise<Buffer> {
    const keyPath = path.join(this.config.dataDir, ISOLATION_KEY_FILE);
    try {
      const existing = await fs.readFile(keyPath);
      if (existing.length !== 32) throw new Error("isolation key must be exactly 32 bytes");
      return existing;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(`[memory] invalid ${ISOLATION_KEY_FILE}`, { cause: error });
      }
    }
    const created = randomBytes(32);
    try {
      await fs.writeFile(keyPath, created, { mode: 0o600, flag: "wx" });
      return created;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await fs.readFile(keyPath);
      if (existing.length !== 32) throw new Error(`[memory] invalid ${ISOLATION_KEY_FILE}`);
      return existing;
    }
  }

  private async verifyEncryptionKey(): Promise<void> {
    const checkPath = path.join(this.config.dataDir, ENCRYPTION_CHECK_FILE);
    const encrypted = Boolean(this.config.encryptionKeyEnv);
    try {
      const encoded = await fs.readFile(checkPath, "utf8");
      const decoded = this.codec.decode(encoded.trim()) as {
        value?: unknown;
        encrypted?: unknown;
      };
      if (
        decoded?.value !== ENCRYPTION_CHECK_VALUE ||
        decoded.encrypted !== encrypted
      ) {
        throw new Error("unexpected encryption check value");
      }
      return;
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "ENOENT" &&
        !(error instanceof Error && error.message === "unexpected encryption check value")
      ) {
        throw new Error("[memory] encryption key validation failed", { cause: error });
      }
    }

    const existingFiles = await this.listJsonlFiles(path.join(this.config.dataDir, "agents"));
    for (const filePath of existingFiles) {
      await this.readDecodedLines(filePath);
    }
    const encoded = this.codec.encode({ value: ENCRYPTION_CHECK_VALUE, encrypted });
    try {
      const temporaryPath = `${checkPath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(temporaryPath, `${encoded}\n`, { mode: 0o600, flag: "wx" });
      await fs.rename(temporaryPath, checkPath);
    } catch (error) {
      throw new Error("[memory] could not persist encryption key validation marker", {
        cause: error,
      });
    }
  }

  private async migrateLegacyLayout(): Promise<void> {
    const agentsDir = path.join(this.config.dataDir, "agents");
    for (const agentEntry of await this.safeReadDir(agentsDir)) {
      if (!agentEntry.isDirectory()) continue;
      const agentRoot = path.join(agentsDir, agentEntry.name);
      for (const dirName of ALL_DIRS) {
        const legacyDir = path.join(agentRoot, dirName);
        for (const entry of await this.safeReadDir(legacyDir)) {
          if (!entry.isFile() || !DATE_FILE_PATTERN.test(entry.name)) continue;
          const source = path.join(legacyDir, entry.name);
          const values = await this.readDecodedLines(source);
          for (const value of values) {
            if (!this.hasStorageIdentity(value)) {
              throw new Error(`[memory] legacy record in ${source} has no session identity`);
            }
            const targetDir =
              "level" in value && typeof value.level === "string"
                ? levelDir(value.level as MemoryLevel)
                : dirName;
            const target = this.filePathWithDate(
              agentRoot,
              value.sessionKey,
              targetDir,
              entry.name,
            );
            if (!(await this.fileHasId(target, value.id))) {
              await this.appendLine(target, value);
            }
          }
          const backup = path.join(agentRoot, ".legacy-backup", dirName, entry.name);
          await this.ensureParent(backup);
          await fs.rename(source, backup);
        }
      }
    }
  }

  private filePathWithDate(
    agentRoot: string,
    sessionKey: string,
    dirName: MemoryDir,
    fileName: string,
  ): string {
    if (dirName === "profiles" && this.config.profileScope === "agent") {
      return path.join(agentRoot, "agent-profiles", fileName);
    }
    return path.join(agentRoot, "sessions", this.sessionToken(sessionKey), dirName, fileName);
  }

  private async fileHasId(filePath: string, id: string): Promise<boolean> {
    const existing = await this.readDecodedLines(filePath);
    return existing.some(
      (value) =>
        Boolean(value) && typeof value === "object" && (value as { id?: unknown }).id === id,
    );
  }

  private hasStorageIdentity(value: unknown): value is {
    id: string;
    sessionKey: string;
    level?: string;
  } {
    if (!value || typeof value !== "object") return false;
    const candidate = value as { id?: unknown; sessionKey?: unknown };
    return typeof candidate.id === "string" && typeof candidate.sessionKey === "string";
  }

  private async discoverActiveFiles(): Promise<void> {
    this.knownFiles.clear();
    const files = await this.listJsonlFiles(path.join(this.config.dataDir, "agents"));
    for (const filePath of files) {
      if (this.isActiveFile(filePath)) this.knownFiles.add(filePath);
    }
  }

  private isActiveFile(filePath: string): boolean {
    if (!DATE_FILE_PATTERN.test(path.basename(filePath))) return false;
    const normalized = filePath.split(path.sep).join("/");
    if (normalized.includes("/.legacy-backup/")) return false;
    return (
      /\/sessions\/[a-f0-9]{32}\/(conversations|memories|scenarios|profiles)\/\d{4}-\d{2}-\d{2}\.jsonl$/.test(
        normalized,
      ) ||
      (this.config.profileScope === "agent" &&
        /\/agent-profiles\/\d{4}-\d{2}-\d{2}\.jsonl$/.test(normalized))
    );
  }

  private async listJsonlFiles(root: string): Promise<string[]> {
    const files: string[] = [];
    const visit = async (dir: string): Promise<void> => {
      for (const entry of await this.safeReadDir(dir)) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await visit(entryPath);
        } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          files.push(entryPath);
        }
      }
    };
    await visit(root);
    return files;
  }

  private async safeReadDir(dir: string): Promise<import("node:fs").Dirent[]> {
    try {
      return await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private isMemoryRecord(value: unknown): value is MemoryRecord {
    if (!value || typeof value !== "object") return false;
    const record = value as Partial<MemoryRecord>;
    return (
      typeof record.content === "string" &&
      Array.isArray(record.keywords) &&
      typeof record.level === "string" &&
      typeof record.sessionKey === "string"
    );
  }

  private enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    this.queues.set(key, next);
    return next.finally(() => {
      if (this.queues.get(key) === next) this.queues.delete(key);
    }) as Promise<T>;
  }

  private async drain(): Promise<void> {
    await Promise.allSettled([...this.queues.values()]);
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error("[memory] store is closed");
  }

  private ensureReady(): void {
    this.ensureOpen();
    if (!this.initialized || !this.isolationKey) {
      throw new Error("[memory] store is not initialized");
    }
  }
}
