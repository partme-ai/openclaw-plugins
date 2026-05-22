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
import { createIdempotencyCache } from "@partme.ai/openclaw-message-sdk";
import {
  normalizeWireIngress,
  dispatchChannelMessage,
  resolveChannelDispatchIdentity,
  type BridgePluginRuntime,
} from "@partme.ai/openclaw-message-sdk/bridge";

/** Web MQTT 入站幂等缓存。 */
const idempotencyCache = createIdempotencyCache({ ttlMs: 60_000, maxEntries: 10_000 });

/**
 * 构造入站幂等键：优先 MQTT messageId，否则 client+topic+payload 指纹。
 */
function resolveInboundIdempotencyKey(event: InboundEvent): string | undefined {
  if (event.messageId) {
    return event.messageId;
  }
  const payloadPreview = event.payload.toString("utf-8").slice(0, 200);
  return `${event.clientId}:${event.topic}:${payloadPreview}`;
}

/**
 * 入站处理结果。
 */
export type InboundResult = {
  accepted: boolean;
  reason?: string;
  routeSource?: "binding" | "standard";
};

/**
 * 处理一条入站消息并分发到 OpenClaw。
 */
export async function processInbound(event: InboundEvent, config: WebMqttConfig): Promise<InboundResult> {
  const route = resolveInboundRoute(event.topic, config);
  if (!route) {
    return { accepted: false, reason: "topic_not_allowed_or_not_routable" };
  }
  if (event.payload.length > config.limits.maxPayloadBytes) {
    return { accepted: false, reason: "payload_too_large" };
  }

  const idempotencyKey = resolveInboundIdempotencyKey(event);
  const parsed = normalizeWireIngress({
    rawPayload: event.payload.toString("utf-8"),
    mode: config.payload.mode,
    channel: "mqtt-ws",
    idempotencyKey,
    idempotency: idempotencyCache,
  });
  if (!parsed.accepted) {
    return { accepted: false, reason: "duplicate" };
  }
  const text = parsed.text;
  if (typeof text !== "string" || !text.trim()) {
    return { accepted: false, reason: "empty_payload" };
  }

  const runtime = tryGetWebMqttRuntime();
  if (!runtime) {
    return { accepted: false, reason: "runtime_not_initialized" };
  }

  const { agentId, sessionKey } = await resolveChannelDispatchIdentity(runtime as unknown as BridgePluginRuntime, {
    channel: "mqtt-ws",
    accountId: route.accountId,
    peerId: event.clientId,
    agentId: route.agentId,
  });

  upsertSessionContext(sessionKey, {
    clientId: event.clientId,
    agentId,
    accountId: route.accountId,
    lastInboundTopic: event.topic,
    replyTopic: route.replyTopic,
  });

  const username = getClientUsername(event.clientId);
  const user = config.auth.users.find((entry) => entry.username === username);
  if (
    user &&
    !isUserActionAllowed({
      user,
      action: "inbound",
      topic: event.topic,
      accountId: route.accountId,
    })
  ) {
    return { accepted: false, reason: "acl_inbound_denied" };
  }

  const outboundFormat =
    (config.payload.outboundFormat as "envelope" | "legacyJsonText" | "plainText" | undefined) ??
    "envelope";

  await dispatchChannelMessage({
    mode: "reply-pipeline",
    runtime: runtime as unknown as BridgePluginRuntime,
    channel: "mqtt-ws",
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
        await publishOutboundText(sessionKey, wire, config.topicPrefix);
      },
      outboundFormat,
      replyRoute: {
        topic: route.replyTopic ?? `${config.topicPrefix}agent/${agentId}/out`,
      },
      agentId,
    },
  });

  return { accepted: true, routeSource: route.source };
}
