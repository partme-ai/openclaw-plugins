/**
 * @module shared/wire-helpers
 *
 * Wire 入站辅助：幂等键、payload 模式映射、幂等缓存（message-sdk 薄封装）。
 */

import {
  createIdempotencyCache,
  getGlobalSingleton,
  type IdempotencyCache,
  type PayloadParseMode,
} from "@partme.ai/openclaw-message-sdk";

import { WEB_MQTT_CHANNEL_ID } from "../config/resolvers.js";
import type { InboundEvent } from "../types.js";

const DEFAULT_IDEMPOTENCY_TTL_MS = 60_000;
const DEFAULT_IDEMPOTENCY_MAX_ENTRIES = 10_000;

/** Web MQTT 配置中的 payload 模式。 */
export type WebMqttWirePayloadMode = "jsonTextOrPlain";

/**
 * 将 Web MQTT payload.mode 映射为 message-sdk PayloadParseMode。
 */
export function mapWebMqttWirePayloadMode(mode: WebMqttWirePayloadMode): PayloadParseMode {
  return mode === "jsonTextOrPlain" ? "jsonTextOrPlain" : "plain";
}

/**
 * 返回 Web MQTT 入站幂等缓存（进程内单例，委托 message-sdk）。
 */
export function getWebMqttIdempotencyCache(): IdempotencyCache {
  return getGlobalSingleton(`message-sdk:${WEB_MQTT_CHANNEL_ID}:idempotency`, () =>
    createIdempotencyCache({
      ttlMs: DEFAULT_IDEMPOTENCY_TTL_MS,
      maxEntries: DEFAULT_IDEMPOTENCY_MAX_ENTRIES,
    }),
  );
}

/**
 * 构造入站幂等键：优先 MQTT messageId，否则 client+topic+payload 指纹。
 *
 * @param event - 入站 MQTT 事件
 * @param payloadText - 可选，已解码的 UTF-8 payload（避免重复 toString）
 */
export function resolveWebMqttInboundIdempotencyKey(
  event: InboundEvent,
  payloadText?: string,
): string | undefined {
  if (event.messageId) {
    return event.messageId;
  }
  const preview = (payloadText ?? event.payload.toString("utf-8")).slice(0, 200);
  return `${event.clientId}:${event.topic}:${preview}`;
}
