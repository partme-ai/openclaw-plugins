/**
 * @fileoverview 路由幂等去重模块：防止 Hook 重试或重复事件导致多次 forward/reply-via。
 *
 * @description
 * `RouteDedupeCache` 提供 TTL + 容量上限的内存 dedupe；`buildRouteDedupeKey`
 * 将 runId、messageId、ruleId 等片段拼成稳定键。
 *
 * @module dedupe
 */

/**
 * Router 路由去重 — Base Profile 入口。
 */

/** @description 默认 TTL：1 小时。 */
const DEFAULT_TTL_MS = 60 * 60 * 1000;

/** @description 默认最大缓存条目数。 */
const DEFAULT_MAX_ENTRIES = 10_000;

/**
 * @description 基于 TTL 的幂等键缓存，用于路由动作去重。
 */
export class RouteDedupeCache {
  private readonly seen = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  /**
   * @description 构造去重缓存。
   * @param ttlMs - 键存活 TTL（毫秒）。
   * @param maxEntries - 最大条目数（超出时淘汰最旧键）。
   */
  constructor(ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  /**
   * @description 若键已处理过则返回 true（应跳过）；否则登记并返回 false。
   * @param key - 幂等键。
   * @returns 是否应跳过本次路由动作。
   * @throws 不抛出。
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

  /**
   * @description 清空缓存（测试或 gateway_stop 时使用）。
   * @returns void
   * @throws 不抛出。
   */
  clear(): void {
    this.seen.clear();
  }

  /**
   * @description 移除已过期的键（shouldSkip 前 lazy 调用）。
   * @returns void
   * @throws 不抛出。
   */
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
 * @description 将路由 dedupe 片段拼成冒号分隔的稳定键。
 * @param parts - 可选字符串片段（空值过滤）。
 * @returns 幂等键字符串。
 * @throws 不抛出。
 */
export function buildRouteDedupeKey(parts: Array<string | undefined>): string {
  return parts.filter((part) => part && part.length > 0).join(":");
}
