/**
 * 入站处理模块。
 * 执行 topic 路由、payload 解析、session 上下文记录与 runtime 分发。
 */

import { resolveInboundRoute } from "./topic-router.js";
import { getOrCreateSessionContext } from "./session-mapper.js";
import { tryGetWebMqttRuntime } from "./runtime.js";
import type { InboundEvent, WebMqttConfig } from "./types.js";
import { getClientUsername } from "./ws-server.js";
import { isUserActionAllowed } from "./acl.js";

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

  const text = parseInboundPayload(event.payload, config);
  if (!text.trim()) {
    return { accepted: false, reason: "empty_payload" };
  }

  const runtime = tryGetWebMqttRuntime();
  if (!runtime) {
    return { accepted: false, reason: "runtime_not_initialized" };
  }

  const cfg = runtime.config as Record<string, unknown>;
  const session = getOrCreateSessionContext({
    clientId: event.clientId,
    agentId: route.agentId,
    accountId: route.accountId,
    inboundTopic: event.topic,
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

  const replyOptions = await runtime.channel.routing.resolveAgentRoute({
    cfg,
    channel: "mqtt-ws",
    accountId: route.accountId,
    peer: { kind: \"direct\", id: event.clientId },
  });

  const ctx = await runtime.channel.reply.finalizeInboundContext({
    channel: "mqtt-ws",
    accountId: route.accountId,
    from: event.clientId,
    text,
    chatType: "direct",
    extra: {
      mqttTopic: event.topic,
      mqttClientId: event.clientId,
    },
  });

  const { publishOutboundText } = await import("./outbound.js");
  const dispatcher = runtime.channel.reply.createReplyDispatcherWithTyping({
    deliver: async (payload: { text: string }) => {
      await publishOutboundText(session.sessionKey, payload.text, config.topicPrefix);
    },
  });

  await runtime.channel.reply.dispatchReplyFromConfig({
    ctx,
    cfg,
    dispatcher,
    replyOptions,
  });

  return { accepted: true, routeSource: route.source };
}

/**
 * 解析入站 payload。
 */
export function parseInboundPayload(payload: Buffer, config: WebMqttConfig): string {
  if (config.payload.mode !== "jsonTextOrPlain") {
    return payload.toString("utf-8");
  }
  const raw = payload.toString("utf-8");
  try {
    const data = JSON.parse(raw) as { text?: unknown };
    if (typeof data.text === "string") return data.text;
    return raw;
  } catch {
    return raw;
  }
}
