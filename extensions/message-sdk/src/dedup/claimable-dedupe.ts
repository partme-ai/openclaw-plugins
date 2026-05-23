/**
 * Claimable 去重：claim -> commit/release，适合 webhook replay guard 与入站处理锁。
 */

import type { PersistentDedupe } from "./persistent-dedupe.js";

/**
 * ClaimableDedupeClaimKind 是 dedup 模块的公开类型别名。
 *
 * 该类型用于收窄调用边界，确保不同通道插件复用同一套 SDK 契约。
 */
export type ClaimableDedupeClaimKind = "claimed" | "duplicate" | "inflight" | "invalid";

/**
 * ClaimableDedupeClaim 是 dedup 模块的公开类型别名。
 *
 * 该类型用于收窄调用边界，确保不同通道插件复用同一套 SDK 契约。
 */
export type ClaimableDedupeClaim = {
  kind: ClaimableDedupeClaimKind;
  key: string;
};

/**
 * ClaimableDedupeOptions 是 dedup 模块的公开类型别名。
 *
 * 该类型用于收窄调用边界，确保不同通道插件复用同一套 SDK 契约。
 */
export type ClaimableDedupeOptions = {
  ttlMs: number;
  memoryMaxSize: number;
  persistent?: PersistentDedupe;
  namespace?: string;
  onPersistentError?: (error: unknown) => void;
};

/**
 * ClaimableDedupeClaimOptions 是 dedup 模块的公开类型别名。
 *
 * 该类型用于收窄调用边界，确保不同通道插件复用同一套 SDK 契约。
 */
export type ClaimableDedupeClaimOptions = {
  now?: number;
  namespace?: string;
};

/**
 * ClaimableDedupeReleaseOptions 是 dedup 模块的公开类型别名。
 *
 * 该类型用于收窄调用边界，确保不同通道插件复用同一套 SDK 契约。
 */
export type ClaimableDedupeReleaseOptions = {
  error?: unknown;
  namespace?: string;
};

/**
 * ClaimableDedupe 是 dedup 模块的公开类型别名。
 *
 * 该类型用于收窄调用边界，确保不同通道插件复用同一套 SDK 契约。
 */
export type ClaimableDedupe = {
  claim: (key: string, options?: ClaimableDedupeClaimOptions) => Promise<ClaimableDedupeClaim>;
  commit: (key: string, options?: ClaimableDedupeClaimOptions) => Promise<void>;
  release: (key: string, options?: ClaimableDedupeReleaseOptions) => void;
  hasRecent: (key: string, options?: ClaimableDedupeClaimOptions) => Promise<boolean>;
  clearMemory: () => void;
  memorySize: () => number;
  inflightSize: () => number;
};

type MemoryRecord = {
  committedAt?: number;
  inflightAt?: number;
};

function normalizeKey(key: string): string {
  return key?.trim() ?? "";
}

function normalizeNamespace(namespace?: string): string {
  return namespace?.trim() || "global";
}

function scopedKey(namespace: string, key: string): string {
  return `${namespace}:${key}`;
}

function isRecordRecent(record: MemoryRecord | undefined, now: number, ttlMs: number): boolean {
  const committedAt = record?.committedAt;
  return committedAt != null && (ttlMs <= 0 || now - committedAt < ttlMs);
}

/**
 * createClaimableDedupe 是 dedup 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
 */
export function createClaimableDedupe(options: ClaimableDedupeOptions): ClaimableDedupe {
  const ttlMs = Math.max(0, Math.floor(options.ttlMs));
  const memoryMaxSize = Math.max(0, Math.floor(options.memoryMaxSize));
  const memory = new Map<string, MemoryRecord>();

  function prune(now: number): void {
    if (ttlMs > 0) {
      for (const [key, record] of memory) {
        const committedExpired =
          record.committedAt == null || now - record.committedAt >= ttlMs;
        const inflightExpired = record.inflightAt == null || now - record.inflightAt >= ttlMs;
        if (committedExpired && inflightExpired) memory.delete(key);
      }
    }
    if (memoryMaxSize > 0 && memory.size > memoryMaxSize) {
      const sorted = [...memory.entries()].sort((a, b) => {
        const left = Math.max(a[1].committedAt ?? 0, a[1].inflightAt ?? 0);
        const right = Math.max(b[1].committedAt ?? 0, b[1].inflightAt ?? 0);
        return left - right;
      });
      for (const [key] of sorted.slice(0, memory.size - memoryMaxSize)) {
        memory.delete(key);
      }
    }
  }

  async function hasPersistentRecent(params: {
    key: string;
    namespace: string;
    now: number;
  }): Promise<boolean> {
    if (!options.persistent) return false;
    try {
      return await options.persistent.hasRecent(params.key, {
        namespace: params.namespace,
        now: params.now,
        onDiskError: options.onPersistentError,
      });
    } catch (err) {
      options.onPersistentError?.(err);
      return false;
    }
  }

  async function hasRecent(key: string, claimOptions?: ClaimableDedupeClaimOptions): Promise<boolean> {
    const normalized = normalizeKey(key);
    if (!normalized) return false;
    const namespace = normalizeNamespace(claimOptions?.namespace ?? options.namespace);
    const now = claimOptions?.now ?? Date.now();
    prune(now);
    const scoped = scopedKey(namespace, normalized);
    const record = memory.get(scoped);
    if (isRecordRecent(record, now, ttlMs)) return true;
    return await hasPersistentRecent({ key: normalized, namespace, now });
  }

  return {
    async claim(key, claimOptions) {
      const normalized = normalizeKey(key);
      if (!normalized) return { kind: "invalid", key: "" };
      const namespace = normalizeNamespace(claimOptions?.namespace ?? options.namespace);
      const now = claimOptions?.now ?? Date.now();
      prune(now);
      const scoped = scopedKey(namespace, normalized);
      const record = memory.get(scoped);
      if (isRecordRecent(record, now, ttlMs)) return { kind: "duplicate", key: normalized };
      if (record?.inflightAt != null && (ttlMs <= 0 || now - record.inflightAt < ttlMs)) {
        return { kind: "inflight", key: normalized };
      }
      if (await hasPersistentRecent({ key: normalized, namespace, now })) {
        memory.set(scoped, { committedAt: now });
        return { kind: "duplicate", key: normalized };
      }
      memory.set(scoped, { ...record, inflightAt: now });
      return { kind: "claimed", key: normalized };
    },

    async commit(key, commitOptions) {
      const normalized = normalizeKey(key);
      if (!normalized) return;
      const namespace = normalizeNamespace(commitOptions?.namespace ?? options.namespace);
      const now = commitOptions?.now ?? Date.now();
      prune(now);
      const scoped = scopedKey(namespace, normalized);
      memory.set(scoped, { committedAt: now });
      if (!options.persistent) return;
      try {
        await options.persistent.checkAndRecord(normalized, {
          namespace,
          now,
          onDiskError: options.onPersistentError,
        });
      } catch (err) {
        options.onPersistentError?.(err);
      }
    },

    release(key, releaseOptions) {
      const normalized = normalizeKey(key);
      if (!normalized) return;
      const namespace = normalizeNamespace(releaseOptions?.namespace ?? options.namespace);
      const scoped = scopedKey(namespace, normalized);
      const record = memory.get(scoped);
      if (!record) return;
      if (record.committedAt != null) {
        memory.set(scoped, { committedAt: record.committedAt });
        return;
      }
      memory.delete(scoped);
    },

    hasRecent,

    clearMemory() {
      memory.clear();
    },

    memorySize() {
      return memory.size;
    },

    inflightSize() {
      let count = 0;
      const now = Date.now();
      prune(now);
      for (const record of memory.values()) {
        if (record.inflightAt != null && (ttlMs <= 0 || now - record.inflightAt < ttlMs)) {
          count += 1;
        }
      }
      return count;
    },
  };
}
