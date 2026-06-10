/**
 * @module shared/wire-helpers
 *
 * Wire 入站辅助：payload 模式映射、配置化幂等缓存（message-sdk 薄封装）。
 */

import {
  createIdempotencyCache,
  getGlobalSingleton,
  type IdempotencyCache,
  type PayloadParseMode,
} from "@partme.ai/openclaw-message-sdk";

import { RABBITMQ_CHANNEL_ID } from "../config/resolvers.js";

/** RabbitMQ 配置中的 payload 模式（映射至 SDK PayloadParseMode）。 */
export type RabbitmqWirePayloadMode = "jsonTextOrPlain" | "jsonOnly" | "plainText";

/**
 * 将 RabbitMQ payload.mode 映射为 message-sdk PayloadParseMode。
 */
export function mapRabbitmqWirePayloadMode(mode: RabbitmqWirePayloadMode): PayloadParseMode {
  if (mode === "plainText") return "plain";
  if (mode === "jsonOnly") return "jsonOnly";
  return "jsonTextOrPlain";
}

/**
 * 按 idempotency 配置懒创建幂等缓存（配置签名变化时重建 singleton key）。
 */
export function getRabbitmqIdempotencyCache(params: {
  enabled: boolean;
  ttlMs: number;
  maxEntries: number;
}): IdempotencyCache | undefined {
  if (!params.enabled) {
    return undefined;
  }
  const sig = `${params.ttlMs}:${params.maxEntries}`;
  return getGlobalSingleton(`message-sdk:${RABBITMQ_CHANNEL_ID}:idempotency:${sig}`, () =>
    createIdempotencyCache({
      ttlMs: params.ttlMs,
      maxEntries: params.maxEntries,
    }),
  );
}
