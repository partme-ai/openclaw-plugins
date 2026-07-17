/**
 * 入站处理模块。
 * 执行 topic 路由、payload 解析、session 上下文记录与 runtime 分发（message-sdk 桥接）。
 */

import { resolveInboundRoute } from "./routing/topic-router.js";
import { upsertSessionContext } from "./routing/session-mapper.js";
import { tryGetWebMqttRuntime } from "./runtime.js";
import type { InboundEvent, WebMqttConfig } from "./types.js";
import { getClientUsername } from "./transport/server.js";
import { isUserActionAllowed } from "./transport/acl.js";
import {
  normalizeWireIngress,
  dispatchChannelMessage,
  resolveChannelDispatchIdentity,
  type BridgePluginRuntime,
} from "@partme.ai/openclaw-message-sdk/bridge";
import { WEB_MQTT_CHANNEL_ID } from "./config/resolvers.js";
import { resolvePayloadMode } from "@partme.ai/openclaw-message-sdk/transport";
import {
  getWebMqttClaimableDedupe,
  resolveWebMqttInboundIdempotencyKey,
} from "./shared/wire-helpers.js";

/**
 * 入站处理结果。
 */
export type InboundResult = {
  accepted: boolean;
  reason?: string;
  routeSource?: "binding" | "standard";
};

/**
 * 处理一条入站 MQTT 消息并分发到 OpenClaw。
 *
 * @param event - 入站事件（clientId、topic、payload 等）
 * @param config - 当前 Web MQTT 通道配置
 * @returns 是否接受及拒绝原因、路由来源
 */
export async function processInbound(event: InboundEvent, config: WebMqttConfig): Promise<InboundResult> {
  const route = resolveInboundRoute(event.topic, config);
  if (!route) {
    return { accepted: false, reason: "topic_not_allowed_or_not_routable" };
  }
  if (event.payload.length > config.limits.maxPayloadBytes) {
    return { accepted: false, reason: "payload_too_large" };
  }

  const payloadText = event.payload.toString("utf-8");
  const idempotencyKey = resolveWebMqttInboundIdempotencyKey(event, payloadText);
  const parsed = normalizeWireIngress({
    rawPayload: payloadText,
    mode: resolvePayloadMode(config.payload.mode),
    channel: WEB_MQTT_CHANNEL_ID,
  });
  const text = parsed.text;
  if (typeof text !== "string" || !text.trim()) {
    return { accepted: false, reason: "empty_payload" };
  }

  // transport 传入的是 CONNECT 时的身份快照；fallback 只兼容直接调用旧事件结构的测试/集成。
  const username = event.authenticatedUsername ?? getClientUsername(event.clientId);
  const user = config.auth.users.find((entry) => entry.username === username);
  if (
    config.auth.required &&
    (!user ||
      !isUserActionAllowed({
        user,
        action: "inbound",
        topic: event.topic,
        accountId: route.accountId,
      }))
  ) {
    return {
      accepted: false,
      reason: user ? "acl_inbound_denied" : "acl_inbound_identity_missing",
    };
  }

  const runtime = tryGetWebMqttRuntime();
  if (!runtime) {
    return { accepted: false, reason: "runtime_not_initialized" };
  }

  const dedupe = getWebMqttClaimableDedupe();
  const claim = idempotencyKey ? await dedupe.claim(idempotencyKey) : undefined;
  if (claim && (claim.kind === "duplicate" || claim.kind === "inflight")) {
    return { accepted: false, reason: "duplicate" };
  }

  try {
    const { agentId, sessionKey } = await resolveChannelDispatchIdentity(runtime as unknown as BridgePluginRuntime, {
      channel: WEB_MQTT_CHANNEL_ID,
      accountId: route.accountId,
      peerId: event.clientId,
      agentId: route.agentId,
    });

    upsertSessionContext(sessionKey, {
      clientId: event.clientId,
      authenticatedUsername: username ?? undefined,
      agentId,
      accountId: route.accountId,
      lastInboundTopic: event.topic,
      replyTopic: route.replyTopic,
    });

    const outboundFormat =
      (config.payload.outboundFormat as "envelope" | "legacyJsonText" | "plainText" | undefined) ??
      "envelope";
    // 回复闭包捕获本次消息的身份和路由；后续 clientId 接管即使覆盖 sessionContext 也不会串权或串 Topic。
    const replyTopic = route.replyTopic ?? `${config.topicPrefix}agent/${agentId}/out`;

    await dispatchChannelMessage({
      mode: "reply-pipeline",
      runtime: runtime as unknown as BridgePluginRuntime,
      channel: WEB_MQTT_CHANNEL_ID,
      accountId: route.accountId,
      peerId: event.clientId,
      text,
      agentId,
      sessionKey,
      unified: parsed.unified,
      extra: {
        mqttTopic: event.topic,
        mqttClientId: event.clientId,
        sessionKey,
      },
      reply: {
        deliver: async ({ wire }: { wire: string }) => {
          const { publishOutboundText } = await import("./outbound.js");
          await publishOutboundText(sessionKey, wire, config.topicPrefix, {
            authenticatedUsername: username ?? undefined,
            topic: replyTopic,
            accountId: route.accountId,
          });
        },
        outboundFormat,
        replyRoute: {
          topic: replyTopic,
        },
        agentId,
      },
    });
    if (idempotencyKey) await dedupe.commit(idempotencyKey);
    return { accepted: true, routeSource: route.source };
  } catch (error) {
    if (idempotencyKey) dedupe.release(idempotencyKey);
    throw error;
  }
}
