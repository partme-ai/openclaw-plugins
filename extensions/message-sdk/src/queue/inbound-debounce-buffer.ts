/**
 * Debounce/coalesce buffer for inbound bursts keyed by conversation or peer.
 *
 * 多数 IM/MQ 平台会把用户连续输入拆成多条事件。该缓冲器用于把同一会话短时间内的
 * 入站消息合并为一个 flush，从而减少 Agent 运行次数，同时保留按 key 隔离的语义。
 */

export type InboundDebounceFlushReason = "timer" | "manual" | "cancel";

/**
 * 一次防抖 flush 的输出结构。
 *
 * @property key - 会话、peer 或调用方自定义的聚合 key。
 * @property items - 本次被 flush 的原始条目。
 * @property value - `coalesce` 产出的聚合值；未提供 coalesce 时为 items。
 * @property reason - 触发 flush 的原因。
 */
export type InboundDebounceFlush<T, R> = {
  key: string;
  items: readonly T[];
  value: R;
  reason: InboundDebounceFlushReason;
};

/**
 * 入站防抖缓冲配置。
 *
 * @property debounceMs - 最后一条消息后等待多久触发 timer flush。
 * @property resolveKey - 从入站条目中解析会话/peer key。
 * @property coalesce - 可选聚合函数，用于把多条消息合并为一个值。
 * @property onFlush - flush 回调，通常在这里调用 Agent 派发。
 * @property maxBatchSize - 达到该数量时立即 flush，避免超长批次。
 */
export type InboundDebounceBufferOptions<T, R = readonly T[]> = {
  debounceMs: number;
  resolveKey: (item: T) => string;
  coalesce?: (items: readonly T[], key: string) => R;
  onFlush: (flush: InboundDebounceFlush<T, R>) => void | Promise<void>;
  maxBatchSize?: number;
};

/**
 * 入站防抖缓冲器实例。
 *
 * @property enqueue - 添加一个条目并重置对应 key 的定时器。
 * @property flush - 手动 flush 指定 key 或全部 key。
 * @property cancel - 丢弃指定 key 或全部 key 的待处理条目。
 * @property pendingKeys - 返回仍有待处理条目的 key。
 * @property pendingSize - 返回指定 key 或全部 key 的待处理数量。
 */
export type InboundDebounceBuffer<T> = {
  enqueue: (item: T) => Promise<void>;
  flush: (key?: string) => Promise<void>;
  cancel: (key?: string) => void;
  pendingKeys: () => string[];
  pendingSize: (key?: string) => number;
};

type PendingBatch<T> = {
  items: T[];
  timer?: ReturnType<typeof setTimeout>;
  flushing: Promise<void>;
};

function normalizeDebounceKey(key: string): string {
  return key?.trim() || "default";
}

/**
 * 创建按 key 聚合的入站防抖缓冲器。
 *
 * @param options - 防抖时间、key 解析、聚合函数和 flush 回调。
 * @returns 内存缓冲器；调用方需要在 shutdown 时调用 `flush` 或 `cancel`。
 */
export function createInboundDebounceBuffer<T, R = readonly T[]>(
  options: InboundDebounceBufferOptions<T, R>,
): InboundDebounceBuffer<T> {
  const debounceMs = Math.max(0, Math.floor(options.debounceMs));
  const maxBatchSize =
    options.maxBatchSize == null ? undefined : Math.max(1, Math.floor(options.maxBatchSize));
  const pending = new Map<string, PendingBatch<T>>();

  function resolveBatch(key: string): PendingBatch<T> {
    let batch = pending.get(key);
    if (!batch) {
      batch = { items: [], flushing: Promise.resolve() };
      pending.set(key, batch);
    }
    return batch;
  }

  function clearBatchTimer(batch: PendingBatch<T>): void {
    if (batch.timer) {
      clearTimeout(batch.timer);
      batch.timer = undefined;
    }
  }

  function scheduleFlush(key: string, batch: PendingBatch<T>): void {
    clearBatchTimer(batch);
    batch.timer = setTimeout(() => {
      void flushKey(key, "timer");
    }, debounceMs);
  }

  async function flushKey(key: string, reason: InboundDebounceFlushReason): Promise<void> {
    const batch = pending.get(key);
    if (!batch || batch.items.length === 0) return;
    clearBatchTimer(batch);
    const items = batch.items.splice(0, batch.items.length);
    pending.delete(key);
    // 先从 pending 移除，再串接 batch.flushing。这样 onFlush 期间新消息会进入新批次，
    // 不会和正在 flush 的旧批次混在一起。
    const value = options.coalesce
      ? options.coalesce(items, key)
      : (items as unknown as R);
    const nextFlush = batch.flushing.then(() =>
      options.onFlush({
        key,
        items,
        value,
        reason,
      }),
    );
    batch.flushing = nextFlush;
    await nextFlush;
  }

  return {
    /**
     * 添加一个条目，并为其 key 重新安排 timer flush。
     */
    async enqueue(item) {
      const key = normalizeDebounceKey(options.resolveKey(item));
      const batch = resolveBatch(key);
      batch.items.push(item);
      if (maxBatchSize && batch.items.length >= maxBatchSize) {
        await flushKey(key, "manual");
        return;
      }
      scheduleFlush(key, batch);
    },

    /**
     * 手动 flush 一个 key；不传 key 时 flush 全部 key。
     */
    async flush(key) {
      if (key != null) {
        await flushKey(normalizeDebounceKey(key), "manual");
        return;
      }
      await Promise.all([...pending.keys()].map((pendingKey) => flushKey(pendingKey, "manual")));
    },

    /**
     * 丢弃一个 key 的待处理条目；不传 key 时丢弃全部待处理条目。
     */
    cancel(key) {
      const keys = key == null ? [...pending.keys()] : [normalizeDebounceKey(key)];
      for (const pendingKey of keys) {
        const batch = pending.get(pendingKey);
        if (!batch) continue;
        clearBatchTimer(batch);
        pending.delete(pendingKey);
      }
    },

    /**
     * 返回当前有待处理条目的 key。
     */
    pendingKeys() {
      return [...pending.keys()];
    },

    /**
     * 返回指定 key 或全部 key 的待处理条目数量。
     */
    pendingSize(key) {
      if (key != null) {
        return pending.get(normalizeDebounceKey(key))?.items.length ?? 0;
      }
      let count = 0;
      for (const batch of pending.values()) count += batch.items.length;
      return count;
    },
  };
}
