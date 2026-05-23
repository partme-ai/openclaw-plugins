/**
 * 路由幂等去重 — 防止 hook 重试或 duplicate 事件导致重复转发。
 */

/** 默认 TTL：1 小时 */
const DEFAULT_TTL_MS = 60 * 60 * 1000;

/** 默认最大条目数 */
const DEFAULT_MAX_ENTRIES = 10_000;

/**
 * 基于 TTL 的幂等键缓存。
 */
export class RouteDedupeCache {
  private readonly seen = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  /**
   * 若键已处理过则返回 true（应跳过）；否则登记并返回 false。
   *
   * @param key - 幂等键
   */
  shouldSkip(key: string): boolean {
    this.pruneExpired();
    const now = Date.now();
    const expiresAt = this.seen.get(key);
    if (expiresAt !== undefined && expiresAt > now) {
      return true;
    }
    this.seen.set(key, now + this.ttlMs);
    if (this.seen.size > this.maxEntries) {
      const oldest = this.seen.keys().next().value;
      if (oldest) {
        this.seen.delete(oldest);
      }
    }
    return false;
  }

  /** 清空缓存（测试或 gateway_stop 时使用） */
  clear(): void {
    this.seen.clear();
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.seen) {
      if (expiresAt <= now) {
        this.seen.delete(key);
      }
    }
  }
}

/**
 * 构建路由幂等键。
 */
export function buildRouteDedupeKey(parts: Array<string | undefined>): string {
  return parts.filter((part) => part && part.length > 0).join(":");
}
