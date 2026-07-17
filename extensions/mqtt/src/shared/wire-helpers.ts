/**
 * @module shared/wire-helpers
 *
 * Wire 入站辅助：幂等缓存（委托 message-sdk transport）。
 */

import { createChannelIdempotencyCache } from "@partme.ai/openclaw-message-sdk/transport";
import type { IdempotencyCache } from "@partme.ai/openclaw-message-sdk";
import { createHash } from "node:crypto";

import { MQTT_CHANNEL_ID } from "../config/resolvers.js";
import type { MqttInboundMessage } from "../types.js";

/**
 * 返回 MQTT 入站幂等缓存（进程内单例，委托 message-sdk transport）。
 */
export function getMqttIdempotencyCache(): IdempotencyCache {
  return createChannelIdempotencyCache(MQTT_CHANNEL_ID);
}

/**
 * 构造 MQTT Packet Identifier 的正确去重作用域。
 *
 * MQTT messageId 只在一个客户端会话内有效，并会在 PUBACK 后复用；仅用数字编号会让
 * 不同设备相互误去重。加入 clientId、topic 与载荷摘要后，既能识别 QoS 重投，也允许
 * 相同编号承载下一条不同消息，且不会把完整业务载荷长期保存在幂等缓存中。
 */
export function buildMqttPacketIdempotencyKey(message: MqttInboundMessage): string | undefined {
  if (message.messageId === undefined) return undefined;
  const digest = createHash("sha256").update(message.payload).digest("hex");
  return `${message.clientId}\u0000${message.topic}\u0000${message.messageId}\u0000${digest}`;
}
