/**
 * @module shared/wire-helpers
 *
 * Wire 入站辅助：幂等缓存、幂等键（委托 message-sdk transport）。
 */

import { createChannelIdempotencyCache } from "@partme.ai/openclaw-message-sdk/transport";
import type { IdempotencyCache } from "@partme.ai/openclaw-message-sdk";

import { WEB_MQTT_CHANNEL_ID } from "../config/resolvers.js";
import type { InboundEvent } from "../types.js";

/**
 * 返回 Web MQTT 入站幂等缓存（进程内单例，委托 message-sdk transport）。
 */
export function getWebMqttIdempotencyCache(): IdempotencyCache {
  return createChannelIdempotencyCache(WEB_MQTT_CHANNEL_ID);
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
