/**
 * @module shared/wire-helpers
 *
 * Wire 入站幂等缓存（message-sdk 薄封装）。
 */

import {
  createIdempotencyCache,
  getGlobalSingleton,
  type IdempotencyCache,
} from "@partme.ai/openclaw-message-sdk";

import { WEB_SOCKET_CHANNEL_ID } from "../config/resolvers.js";

const DEFAULT_IDEMPOTENCY_TTL_MS = 60_000;
const DEFAULT_IDEMPOTENCY_MAX_ENTRIES = 10_000;

/**
 * 返回 WebSocket 入站幂等缓存（进程内单例）。
 */
export function getWebsocketIdempotencyCache(): IdempotencyCache {
  return getGlobalSingleton(`message-sdk:${WEB_SOCKET_CHANNEL_ID}:idempotency`, () =>
    createIdempotencyCache({
      ttlMs: DEFAULT_IDEMPOTENCY_TTL_MS,
      maxEntries: DEFAULT_IDEMPOTENCY_MAX_ENTRIES,
    }),
  );
}
