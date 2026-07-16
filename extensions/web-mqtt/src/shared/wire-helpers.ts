/**
 * @module shared/wire-helpers
 *
 * Wire 入站辅助：幂等缓存、幂等键（委托 message-sdk transport）。
 */

import {
  createClaimableDedupe,
  getGlobalSingleton,
  type ClaimableDedupe,
} from "@partme.ai/openclaw-message-sdk";

import { WEB_MQTT_CHANNEL_ID } from "../config/resolvers.js";
import type { InboundEvent } from "../types.js";

/**
 * 返回 Web MQTT 入站幂等缓存（进程内单例，委托 message-sdk transport）。
 */
export function getWebMqttClaimableDedupe(): ClaimableDedupe {
  return getGlobalSingleton(`message-sdk:${WEB_MQTT_CHANNEL_ID}:claimable`, () =>
    createClaimableDedupe({ ttlMs: 10 * 60_000, memoryMaxSize: 10_000 }),
  );
}

/**
 * 构造应用级幂等键。MQTT packet messageId 只在当前 in-flight 窗口唯一，
 * 且会被客户端合法复用，因此不能作为跨 Agent Turn 的幂等键。
 *
 * @param event - 入站 MQTT 事件
 * @param payloadText - 可选，已解码的 UTF-8 payload（避免重复 toString）
 */
export function resolveWebMqttInboundIdempotencyKey(
  event: InboundEvent,
  payloadText?: string,
): string | undefined {
  const text = payloadText ?? event.payload.toString("utf-8");
  try {
    const payload = JSON.parse(text) as Record<string, unknown>;
    const message = typeof payload.message === "object" && payload.message
      ? payload.message as Record<string, unknown>
      : undefined;
    const headers = typeof payload.headers === "object" && payload.headers
      ? payload.headers as Record<string, unknown>
      : undefined;
    const candidate = payload.idempotencyKey ?? payload.messageId ?? message?.messageId ?? headers?.idempotencyKey;
    if (typeof candidate === "string" && candidate.trim()) {
      return `${event.clientId}:${event.topic}:${candidate.trim()}`;
    }
  } catch {
    // Plain text is valid input but intentionally has no application-level dedupe key.
  }
  return undefined;
}
