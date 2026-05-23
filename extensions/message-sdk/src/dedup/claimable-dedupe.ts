/**
 * @module dedup/claimable-dedupe
 *
 * Claimable 去重：claim → commit/release 两阶段语义，适合 webhook replay guard 与入站处理锁。
 *
 * **职责**：
 * - `claim` — 尝试占用 key；返回 claimed / duplicate / inflight / invalid
 * - `commit` — 处理成功后标记为已提交（可写持久层）
 * - `release` — 处理失败时释放 inflight 占用，允许重试
 *
 * **适用场景**：Webhook 并发重放、MQ 消费失败后需释放锁以便重试。
 *
 * **关键导出**：`createClaimableDedupe`、`ClaimableDedupe`、`ClaimableDedupeClaim`
 */

import type { PersistentDedupe } from "./persistent-dedupe.js";

/**
 * claim 结果种类。
 *
 * - `claimed` — 成功占用，可开始处理
 * - `duplicate` — TTL 内已提交过，应跳过
 * - `inflight` — 其他协程正在处理，应跳过或等待
 * - `invalid` — key 无效（空字符串等）
 */
export type ClaimableDedupeClaimKind = "claimed" | "duplicate" | "inflight" | "invalid";

/**
 * claim 操作返回值。
 *
 * @property kind - claim 结果种类
 * @property key - 归一化后的原始 key（invalid 时可能为空）
 */
export type ClaimableDedupeClaim = {
  kind: ClaimableDedupeClaimKind;
  key: string;
};

/**
 * Claimable 去重实例配置。
 *
 * @property ttlMs - committed / inflight 记录的 TTL（毫秒）
 * @property memoryMaxSize - 内存最大条目数
 * @property persistent - 可选持久化去重层（commit 时写入）
 * @property namespace - 默认 namespace
 * @property onPersistentError - 持久层错误回调
 */
export type ClaimableDedupeOptions = {
  ttlMs: number;
  memoryMaxSize: number;
  persistent?: PersistentDedupe;
  namespace?: string;
  onPersistentError?: (error: unknown) => void;
};

/**
 * claim / commit / release 调用选项。
 *
 * @property now - 可选时间戳（测试用）
 * @property namespace - 覆盖默认 namespace
 */
export type ClaimableDedupeClaimOptions = {
  now?: number;
  namespace?: string;
};

/**
 * release 调用选项。
 *
 * @property error - 可选失败原因（当前实现未持久化，供扩展）
 * @property namespace - 覆盖默认 namespace
 */
export type ClaimableDedupeReleaseOptions = {
  error?: unknown;
  namespace?: string;
};

/**
 * Claimable 去重实例 API。
 *
 * @property claim - 尝试占用 key
 * @property commit - 标记处理成功
 * @property release - 释放 inflight 占用（未 commit 时）
 * @property hasRecent - 只读检查是否已提交且在 TTL 内
 * @property clearMemory - 清空内存层
 * @property memorySize - 内存条目数
 * @property inflightSize - 当前 inflight 占用数
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

/** 内存记录：committedAt 表示已成功处理，inflightAt 表示正在处理。 */
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

/** 判断 committed 记录是否在 TTL 内仍有效。 */
function isRecordRecent(record: MemoryRecord | undefined, now: number, ttlMs: number): boolean {
  const committedAt = record?.committedAt;
  return committedAt != null && (ttlMs <= 0 || now - committedAt < ttlMs);
}

/**
 * 创建 Claimable 去重实例。
 *
 * **状态机**：
 * 1. `claim` 成功 → inflightAt 写入
 * 2. 处理成功 → `commit` 写 committedAt（并可选持久化）
 * 3. 处理失败 → `release` 清除 inflight（若未 commit）
 *
 * @param options - TTL、容量与可选持久层
 * @returns Claimable 去重实例
 *
 * @example
 * ```ts
 * const dedupe = createClaimableDedupe({ ttlMs: 60_000, memoryMaxSize: 5000, persistent });
 * const { kind } = await dedupe.claim(webhookId);
 * if (kind !== "claimed") return;
 * try {
 *   await handleWebhook();
 *   await dedupe.commit(webhookId);
 * } catch (err) {
 *   dedupe.release(webhookId, { error: err });
 * }
 * ```
 */
export function createClaimableDedupe(options: ClaimableDedupeOptions): ClaimableDedupe {
  const ttlMs = Math.max(0, Math.floor(options.ttlMs));
  const memoryMaxSize = Math.max(0, Math.floor(options.memoryMaxSize));
  const memory = new Map<string, MemoryRecord>();

  /** TTL 过期 + maxSize 淘汰：committed 与 inflight 均过期才删除。 */
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
      // inflight 且未过期：其他协程正在处理
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
      // 已 commit 的不释放，保留 duplicate 语义
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
