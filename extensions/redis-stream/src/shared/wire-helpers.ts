/**
 * @module shared/wire-helpers
 *
 * Wire 入站辅助：幂等缓存等 message-sdk 薄封装。
 */

import {
  createIdempotencyCache,
  getGlobalSingleton,
  type IdempotencyCache,
  type PayloadParseMode,
} from "@partme.ai/openclaw-message-sdk";

import { REDIS_STREAM_CHANNEL_ID } from "../config/resolvers.js";

const DEFAULT_IDEMPOTENCY_TTL_MS = 60_000;
const DEFAULT_IDEMPOTENCY_MAX_ENTRIES = 10_000;

/**
 * 返回 Redis Stream 入站幂等缓存（进程内单例）。
 */
export function getRedisStreamIdempotencyCache(): IdempotencyCache {
  return getGlobalSingleton(`message-sdk:${REDIS_STREAM_CHANNEL_ID}:idempotency`, () =>
    createIdempotencyCache({
      ttlMs: DEFAULT_IDEMPOTENCY_TTL_MS,
      maxEntries: DEFAULT_IDEMPOTENCY_MAX_ENTRIES,
    }),
  );
}

/**
 * 将 Redis payload.mode 映射为 message-sdk PayloadParseMode。
 */
export function mapRedisStreamWirePayloadMode(
  mode: "plain" | "jsonTextOrPlain",
): PayloadParseMode {
  return mode === "jsonTextOrPlain" ? "jsonTextOrPlain" : "plain";
}
