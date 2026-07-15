/**
 * @module shared/wire-helpers
 *
 * Wire 入站辅助：幂等缓存等 message-sdk 薄封装。
 */

import {
  createClaimableDedupe,
  getGlobalSingleton,
  type ClaimableDedupe,
  type PayloadParseMode,
} from "@partme.ai/openclaw-message-sdk";

import { REDIS_STREAM_CHANNEL_ID } from "../config/resolvers.js";

/**
 * Returns a claim/commit/release dedupe store. Failed processing releases its claim.
 */
export function getRedisStreamClaimableDedupe(params: {
  enabled: boolean;
  ttlMs: number;
  maxEntries: number;
}): ClaimableDedupe | undefined {
  if (!params.enabled) return undefined;
  const signature = `${params.ttlMs}:${params.maxEntries}`;
  return getGlobalSingleton(`message-sdk:${REDIS_STREAM_CHANNEL_ID}:claimable:${signature}`, () =>
    createClaimableDedupe({
      ttlMs: params.ttlMs,
      memoryMaxSize: params.maxEntries,
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
