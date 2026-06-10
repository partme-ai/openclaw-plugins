/**
 * @module dedup/idempotency-cache
 *
 * 单进程内存 TTL 幂等缓存（RabbitMQ / RocketMQ / Redis Stream 等共用）。
 *
 * **职责**：在 `remember(key)` 时记录 key 并返回是否重复；过期或超容量时自动 prune。
 *
 * **适用场景**：`InboundMessageQueue` 入队去重、MQ 消费者进程内短期重复过滤。
 *
 * **关键导出**：`createIdempotencyCache`、`IdempotencyCache`、`IdempotencyCacheOptions`
 */

/**
 * 幂等缓存配置。
 *
 * @property ttlMs - key 存活时间（毫秒）；过期后视为未见过
 * @property maxEntries - 内存最大条目数；超出时按插入顺序淘汰最旧项
 */
export interface IdempotencyCacheOptions {
  ttlMs: number;
  maxEntries: number;
}

/**
 * 内存 TTL 幂等缓存实例。
 *
 * @property has - 查询 key 是否在 TTL 内已见过（不写入）
 * @property remember - 记录 key；返回 `true` 表示重复，`false` 表示首次见到
 * @property prune - 手动清理过期项并 enforce maxEntries
 * @property clear - 清空全部缓存
 */
export interface IdempotencyCache {
  /** 若已见过且未过期则返回 true。 */
  has(key: string): boolean;
  /** 记录 key，返回 true 表示重复（已见过），false 表示首次见到。 */
  remember(key: string): boolean;
  prune(now?: number): void;
  clear(): void;
}

/**
 * 创建内存幂等缓存。
 *
 * 内部以 `Map<key, expireAt>` 存储；`remember` 前先 prune 过期项，
 * 超出 `maxEntries` 时按 Map 迭代顺序删除最旧 key（近似 LRU）。
 *
 * @param options - TTL 与最大容量
 * @returns 幂等缓存实例
 *
 * @example
 * ```ts
 * const cache = createIdempotencyCache({ ttlMs: 60_000, maxEntries: 10_000 });
 * if (!cache.remember(messageId)) {
 *   // 首次见到，继续处理
 * }
 * ```
 */
export function createIdempotencyCache(options: IdempotencyCacheOptions): IdempotencyCache {
  const store = new Map<string, number>();

  /** 清理过期项；若仍超 maxEntries 则淘汰最旧 key。 */
  const prune = (now = Date.now()) => {
    for (const [k, exp] of store) {
      if (exp <= now) store.delete(k);
    }
    if (store.size <= options.maxEntries) return;
    const overflow = store.size - options.maxEntries;
    let i = 0;
    for (const k of store.keys()) {
      store.delete(k);
      if (++i >= overflow) break;
    }
  };

  return {
    has(key: string): boolean {
      const exp = store.get(key);
      if (!exp) return false;
      if (exp <= Date.now()) {
        store.delete(key);
        return false;
      }
      return true;
    },
    remember(key: string): boolean {
      prune();
      if (this.has(key)) return true;
      store.set(key, Date.now() + options.ttlMs);
      return false;
    },
    prune,
    clear() {
      store.clear();
    },
  };
}
