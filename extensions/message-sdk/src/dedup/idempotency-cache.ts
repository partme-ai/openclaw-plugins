/**
 * TTL 幂等缓存（RabbitMQ / RocketMQ / Redis Stream 等共用）。
 */

export interface IdempotencyCacheOptions {
  ttlMs: number;
  maxEntries: number;
}

export interface IdempotencyCache {
  /** 若已见过且未过期则返回 true。 */
  has(key: string): boolean;
  /** 记录 key，返回 false 表示首次见到。 */
  remember(key: string): boolean;
  prune(now?: number): void;
  clear(): void;
}

/**
 * 创建内存幂等缓存。
 */
export function createIdempotencyCache(options: IdempotencyCacheOptions): IdempotencyCache {
  const store = new Map<string, number>();

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
