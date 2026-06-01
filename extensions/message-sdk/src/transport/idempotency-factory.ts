/**
 * @module message-sdk/transport/idempotency-factory
 *
 * 为各渠道插件创建进程内单例幂等缓存。
 *
 * 四个插件各自的 `wire-helpers.ts` 里的 `getXxxIdempotencyCache()` 逻辑
 * 完全一致，统一为一个工厂函数。
 */

import {
  createIdempotencyCache,
  type IdempotencyCache,
} from "../dedup/idempotency-cache.js";
import { getGlobalSingleton } from "../util/global-singleton.js";

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 10_000;

/**
 * 为指定渠道创建进程内单例幂等缓存。
 *
 * @param channelId - 渠道标识（如 `"mqtt"`、`"web-stomp"`）
 * @param ttlMs - 缓存条目 TTL（默认 60 秒）
 * @param maxEntries - 最大条目数（默认 10,000）
 * @returns IdempotencyCache 实例
 */
export function createChannelIdempotencyCache(
  channelId: string,
  ttlMs: number = DEFAULT_TTL_MS,
  maxEntries: number = DEFAULT_MAX_ENTRIES,
): IdempotencyCache {
  return getGlobalSingleton(`message-sdk:${channelId}:idempotency`, () =>
    createIdempotencyCache({ ttlMs, maxEntries }),
  );
}
