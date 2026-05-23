/**
 * 持久化去重：优先 OpenClaw `createPersistentDedupe`，否则本地 JSON + 内存实现。
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { importOpenClawPluginSdk } from "../openclaw/loader.js";

/**
 * PersistentDedupeCheckOptions 是 dedup 模块的公开类型别名。
 *
 * 该类型用于收窄调用边界，确保不同通道插件复用同一套 SDK 契约。
 */
export type PersistentDedupeCheckOptions = {
  namespace?: string;
  now?: number;
  onDiskError?: (error: unknown) => void;
};

/**
 * PersistentDedupeOptions 是 dedup 模块的公开类型别名。
 *
 * 该类型用于收窄调用边界，确保不同通道插件复用同一套 SDK 契约。
 */
export type PersistentDedupeOptions = {
  ttlMs: number;
  memoryMaxSize: number;
  fileMaxEntries: number;
  resolveFilePath: (namespace: string) => string;
  onDiskError?: (error: unknown) => void;
};

/**
 * PersistentDedupe 是 dedup 模块的公开类型别名。
 *
 * 该类型用于收窄调用边界，确保不同通道插件复用同一套 SDK 契约。
 */
export type PersistentDedupe = {
  checkAndRecord: (key: string, options?: PersistentDedupeCheckOptions) => Promise<boolean>;
  hasRecent: (key: string, options?: PersistentDedupeCheckOptions) => Promise<boolean>;
  warmup: (namespace?: string, onError?: (error: unknown) => void) => Promise<number>;
  clearMemory: () => void;
  memorySize: () => number;
};

type DedupeData = Record<string, number>;

function createMemoryDedupe(ttlMs: number, maxSize: number) {
  const cache = new Map<string, number>();
  return {
    peek(key: string, now: number): boolean {
      const ts = cache.get(key);
      if (ts === undefined) return false;
      if (ttlMs > 0 && now - ts >= ttlMs) {
        cache.delete(key);
        return false;
      }
      return true;
    },
    record(key: string, now: number): void {
      cache.delete(key);
      cache.set(key, now);
      if (maxSize > 0 && cache.size > maxSize) {
        const sorted = [...cache.entries()].sort((a, b) => a[1] - b[1]);
        for (const [k] of sorted.slice(0, cache.size - maxSize)) {
          cache.delete(k);
        }
      }
    },
    clear(): void {
      cache.clear();
    },
    size(): number {
      return cache.size;
    },
  };
}

function pruneData(data: DedupeData, now: number, ttlMs: number, maxEntries: number): void {
  if (ttlMs > 0) {
    for (const [key, ts] of Object.entries(data)) {
      if (now - ts >= ttlMs) delete data[key];
    }
  }
  const keys = Object.keys(data);
  if (keys.length <= maxEntries) return;
  keys
    .sort((a, b) => data[a]! - data[b]!)
    .slice(0, keys.length - maxEntries)
    .forEach((key) => delete data[key]);
}

function createLocalPersistentDedupe(options: PersistentDedupeOptions): PersistentDedupe {
  const ttlMs = Math.max(0, Math.floor(options.ttlMs));
  const memoryMaxSize = Math.max(0, Math.floor(options.memoryMaxSize));
  const fileMaxEntries = Math.max(1, Math.floor(options.fileMaxEntries));
  const memory = createMemoryDedupe(ttlMs, memoryMaxSize);
  const fileQueues = new Map<string, Promise<unknown>>();

  function enqueueFileWrite<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    const prev = fileQueues.get(filePath) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    fileQueues.set(filePath, next);
    return next.finally(() => {
      if (fileQueues.get(filePath) === next) fileQueues.delete(filePath);
    }) as Promise<T>;
  }

  async function readDisk(filePath: string): Promise<DedupeData> {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") return {};
      const out: DedupeData = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = v;
      }
      return out;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return {};
      options.onDiskError?.(err);
      return {};
    }
  }

  async function writeDisk(filePath: string, data: DedupeData): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmp, filePath);
  }

  async function checkAndRecordInner(
    key: string,
    namespace: string,
    now: number,
    onDiskError?: (error: unknown) => void,
  ): Promise<boolean> {
    const scoped = `${namespace}:${key}`;
    if (memory.peek(scoped, now)) return false;

    const filePath = options.resolveFilePath(namespace);
    return enqueueFileWrite(filePath, async () => {
      const data = await readDisk(filePath);
      pruneData(data, now, ttlMs, fileMaxEntries);
      if (data[scoped] != null && (ttlMs <= 0 || now - data[scoped]! < ttlMs)) {
        memory.record(scoped, now);
        return false;
      }
      data[scoped] = now;
      pruneData(data, now, ttlMs, fileMaxEntries);
      try {
        await writeDisk(filePath, data);
        memory.record(scoped, now);
        return true;
      } catch (err) {
        onDiskError?.(err);
        options.onDiskError?.(err);
        return false;
      }
    });
  }

  return {
    async checkAndRecord(key, opts) {
      const trimmed = key?.trim();
      if (!trimmed) return false;
      const namespace = opts?.namespace?.trim() || "global";
      const now = opts?.now ?? Date.now();
      return checkAndRecordInner(trimmed, namespace, now, opts?.onDiskError);
    },
    async hasRecent(key, opts) {
      const trimmed = key?.trim();
      if (!trimmed) return false;
      const namespace = opts?.namespace?.trim() || "global";
      const now = opts?.now ?? Date.now();
      const scoped = `${namespace}:${trimmed}`;
      if (memory.peek(scoped, now)) return true;
      const filePath = options.resolveFilePath(namespace);
      const data = await readDisk(filePath);
      const ts = data[scoped];
      return ts != null && (ttlMs <= 0 || now - ts < ttlMs);
    },
    async warmup(namespace, onError) {
      const ns = namespace?.trim() || "global";
      const filePath = options.resolveFilePath(ns);
      const now = Date.now();
      try {
        const data = await readDisk(filePath);
        let count = 0;
        for (const [scoped, ts] of Object.entries(data)) {
          if (ttlMs > 0 && now - ts >= ttlMs) continue;
          memory.record(scoped, ts);
          count += 1;
        }
        return count;
      } catch (err) {
        onError?.(err);
        return 0;
      }
    },
    clearMemory() {
      memory.clear();
    },
    memorySize() {
      return memory.size();
    },
  };
}

/**
 * 创建持久化去重实例（OpenClaw SDK 优先）。
 */
export async function createPersistentDedupe(
  options: PersistentDedupeOptions,
): Promise<PersistentDedupe> {
  const sdk = await importOpenClawPluginSdk<{
    createPersistentDedupe?: (opts: PersistentDedupeOptions) => PersistentDedupe;
  }>("persistent-dedupe");
  if (typeof sdk?.createPersistentDedupe === "function") {
    return sdk.createPersistentDedupe(options);
  }
  return createLocalPersistentDedupe(options);
}

/** 同步本地实现（无 OpenClaw 时测试/纯 Node 使用）。 */
export function createLocalPersistentDedupeSync(options: PersistentDedupeOptions): PersistentDedupe {
  return createLocalPersistentDedupe(options);
}
