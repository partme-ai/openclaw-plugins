/**
 * @module dedup/persistent-dedupe
 *
 * 持久化去重：优先 OpenClaw `createPersistentDedupe`，否则本地 JSON + 内存双层实现。
 *
 * **职责**：跨进程/重启后仍能拒绝 TTL 内的重复 key；内存层加速热路径，磁盘层保证持久性。
 *
 * **适用场景**：Webhook messageId 去重、MQ 消费 offset 丢失后的 replay 防护。
 *
 * **关键导出**：`createPersistentDedupe`、`createLocalPersistentDedupeSync`、`PersistentDedupe`
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { importOpenClawPluginSdk } from "../openclaw/loader.js";

/**
 * 持久化去重 check/record 调用选项。
 *
 * @property namespace - 逻辑命名空间，默认 `global`；不同 namespace 使用独立磁盘文件
 * @property now - 可选时间戳（测试用），默认 `Date.now()`
 * @property onDiskError - 磁盘读写失败时的回调
 */
export type PersistentDedupeCheckOptions = {
  namespace?: string;
  now?: number;
  onDiskError?: (error: unknown) => void;
};

/**
 * 持久化去重实例配置。
 *
 * @property ttlMs - key 存活时间（毫秒）；0 表示永不过期
 * @property memoryMaxSize - 内存层最大条目数；超出时按时间戳淘汰最旧项
 * @property fileMaxEntries - 磁盘 JSON 最大条目数；超出时 prune 最旧项
 * @property resolveFilePath - 按 namespace 解析磁盘文件路径
 * @property onDiskError - 全局磁盘错误回调
 */
export type PersistentDedupeOptions = {
  ttlMs: number;
  memoryMaxSize: number;
  fileMaxEntries: number;
  resolveFilePath: (namespace: string) => string;
  onDiskError?: (error: unknown) => void;
};

/**
 * 持久化去重实例 API。
 *
 * @property checkAndRecord - 原子「检查并记录」；重复返回 false，首次返回 true
 * @property hasRecent - 只读检查是否在 TTL 内已见过
 * @property warmup - 启动时将磁盘有效条目加载到内存
 * @property clearMemory - 清空内存层（不影响磁盘）
 * @property memorySize - 当前内存层条目数
 */
export type PersistentDedupe = {
  checkAndRecord: (key: string, options?: PersistentDedupeCheckOptions) => Promise<boolean>;
  hasRecent: (key: string, options?: PersistentDedupeCheckOptions) => Promise<boolean>;
  warmup: (namespace?: string, onError?: (error: unknown) => void) => Promise<number>;
  clearMemory: () => void;
  memorySize: () => number;
};

/** 磁盘 JSON 结构：scopedKey → 记录时间戳。 */
type DedupeData = Record<string, number>;

/** 内存层 LRU-ish 缓存（按 timestamp 淘汰）。 */
function createMemoryDedupe(ttlMs: number, maxSize: number) {
  const cache = new Map<string, number>();
  return {
    peek(key: string, now: number): boolean {
      const ts = cache.get(key);
      if (ts === undefined) return false;
      // TTL 过期：从内存删除并视为未见过
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

/** 对磁盘 data 执行 TTL 过期与 maxEntries 裁剪。 */
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

/** 本地 JSON + 内存 fallback 实现（无 OpenClaw SDK 时使用）。 */
function createLocalPersistentDedupe(options: PersistentDedupeOptions): PersistentDedupe {
  const ttlMs = Math.max(0, Math.floor(options.ttlMs));
  const memoryMaxSize = Math.max(0, Math.floor(options.memoryMaxSize));
  const fileMaxEntries = Math.max(1, Math.floor(options.fileMaxEntries));
  const memory = createMemoryDedupe(ttlMs, memoryMaxSize);
  /** 按 filePath 串行化磁盘写入，避免并发写 corrupt JSON。 */
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

  /** 原子写：先写 tmp 再 rename，避免 crash 时半写文件。 */
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
    // 热路径：内存命中则直接判重复
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
 *
 * 若运行环境提供 `createPersistentDedupe`，则委托 SDK；否则使用本地 JSON fallback。
 *
 * @param options - TTL、容量与磁盘路径配置
 * @returns 持久化去重实例
 *
 * @example
 * ```ts
 * const dedupe = await createPersistentDedupe({
 *   ttlMs: 24 * 60 * 60 * 1000,
 *   memoryMaxSize: 10_000,
 *   fileMaxEntries: 50_000,
 *   resolveFilePath: (ns) => path.join(dataDir, `dedupe-${ns}.json`),
 * });
 * if (await dedupe.checkAndRecord(messageId, { namespace: accountId })) {
 *   // 首次见到，继续处理
 * }
 * ```
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

/**
 * 同步创建本地持久化去重（无 OpenClaw SDK 时测试/纯 Node 使用）。
 *
 * @param options - 与 `createPersistentDedupe` 相同
 * @returns 本地 JSON fallback 实例
 */
export function createLocalPersistentDedupeSync(options: PersistentDedupeOptions): PersistentDedupe {
  return createLocalPersistentDedupe(options);
}
