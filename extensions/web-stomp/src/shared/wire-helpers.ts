/**
 * @module shared/wire-helpers
 *
 * Wire 入站辅助：幂等缓存、payload 模式映射（message-sdk 薄封装）。
 */

import {
  createIdempotencyCache,
  getGlobalSingleton,
  type IdempotencyCache,
  type PayloadParseMode,
} from "@partme.ai/openclaw-message-sdk";

import { WEB_STOMP_CHANNEL_ID } from "../config/resolvers.js";

const DEFAULT_IDEMPOTENCY_TTL_MS = 60_000;
const DEFAULT_IDEMPOTENCY_MAX_ENTRIES = 10_000;

/** Web STOMP 固定 Wire payload 模式。 */
export type WebStompWirePayloadMode = "jsonTextOrPlain";

/**
 * 将 Web STOMP payload 模式映射为 message-sdk PayloadParseMode。
 */
export function mapWebStompWirePayloadMode(mode: WebStompWirePayloadMode): PayloadParseMode {
  return mode === "jsonTextOrPlain" ? "jsonTextOrPlain" : "plain";
}

/**
 * 返回 Web STOMP 入站幂等缓存（进程内单例，委托 message-sdk）。
 */
export function getWebStompIdempotencyCache(): IdempotencyCache {
  return getGlobalSingleton(`message-sdk:${WEB_STOMP_CHANNEL_ID}:idempotency`, () =>
    createIdempotencyCache({
      ttlMs: DEFAULT_IDEMPOTENCY_TTL_MS,
      maxEntries: DEFAULT_IDEMPOTENCY_MAX_ENTRIES,
    }),
  );
}
