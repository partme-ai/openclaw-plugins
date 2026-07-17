/**
 * @module wechat/api/config-cache
 *
 * 微信 API 配置缓存与 TTL 刷新。
 */

import { getConfig } from "./api.js";

/** Subset of getConfig fields that we actually need; add new fields here as needed. */
export interface CachedConfig {
  typingTicket: string;
}

const CONFIG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CONFIG_CACHE_INITIAL_RETRY_MS = 2_000;
const CONFIG_CACHE_MAX_RETRY_MS = 60 * 60 * 1000;
const DEFAULT_CONFIG_CACHE_MAX_ENTRIES = 10_000;
const MAX_USER_ID_LENGTH = 256;

interface ConfigCacheEntry {
  config: CachedConfig;
  everSucceeded: boolean;
  nextFetchAt: number;
  retryDelayMs: number;
}

/**
 * Per-user getConfig cache with periodic random refresh (within 24h) and
 * exponential-backoff retry (up to 1h) on failure.
 */
export class WeixinConfigManager {
  private cache = new Map<string, ConfigCacheEntry>();

  constructor(
    private apiOpts: { baseUrl: string; token?: string },
    private log: (msg: string) => void,
    private maxEntries = DEFAULT_CONFIG_CACHE_MAX_ENTRIES,
  ) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new Error("weixin config cache maxEntries must be a positive integer");
    }
  }

  /**
   * 写入并触碰 LRU 顺序。缓存必须有上限，否则不断变化的陌生 userId 会让 Gateway
   * 内存永久增长。最旧项被逐出后仅失去 typing ticket，不影响消息正确性。
   */
  private setEntry(userId: string, entry: ConfigCacheEntry): void {
    this.cache.delete(userId);
    while (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    this.cache.set(userId, entry);
  }

  async getForUser(userId: string, contextToken?: string): Promise<CachedConfig> {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId || normalizedUserId.length > MAX_USER_ID_LENGTH) {
      return { typingTicket: "" };
    }
    const now = Date.now();
    const entry = this.cache.get(normalizedUserId);
    if (entry) {
      // Map 的插入顺序作为轻量 LRU，不需要额外定时器或链表。
      this.cache.delete(normalizedUserId);
      this.cache.set(normalizedUserId, entry);
    }
    const shouldFetch = !entry || now >= entry.nextFetchAt;

    if (shouldFetch) {
      let fetchOk = false;
      try {
        const resp = await getConfig({
          baseUrl: this.apiOpts.baseUrl,
          token: this.apiOpts.token,
          ilinkUserId: normalizedUserId,
          contextToken,
        });
        if (resp.ret === 0) {
          this.setEntry(normalizedUserId, {
            config: { typingTicket: typeof resp.typing_ticket === "string" ? resp.typing_ticket : "" },
            everSucceeded: true,
            nextFetchAt: now + Math.random() * CONFIG_CACHE_TTL_MS,
            retryDelayMs: CONFIG_CACHE_INITIAL_RETRY_MS,
          });
          this.log(
            `[weixin] config ${entry?.everSucceeded ? "refreshed" : "cached"}`,
          );
          fetchOk = true;
        }
      } catch (err) {
        this.log(`[weixin] getConfig failed (ignored): ${err instanceof Error ? err.name : "unknown error"}`);
      }
      if (!fetchOk) {
        const prevDelay = entry?.retryDelayMs ?? CONFIG_CACHE_INITIAL_RETRY_MS;
        const nextDelay = Math.min(prevDelay * 2, CONFIG_CACHE_MAX_RETRY_MS);
        if (entry) {
          entry.nextFetchAt = now + nextDelay;
          entry.retryDelayMs = nextDelay;
        } else {
          this.setEntry(normalizedUserId, {
            config: { typingTicket: "" },
            everSucceeded: false,
            nextFetchAt: now + CONFIG_CACHE_INITIAL_RETRY_MS,
            retryDelayMs: CONFIG_CACHE_INITIAL_RETRY_MS,
          });
        }
      }
    }

    return this.cache.get(normalizedUserId)?.config ?? { typingTicket: "" };
  }
}
