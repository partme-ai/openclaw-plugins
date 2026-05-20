/**
 * MQTT 入站消息处理：Topic 过滤、路由、调用 OpenClaw reply 管线。
 */

import { getMqttRuntime } from "./runtime.js";
import { getMqttChannelConfig } from "./mqtt-state.js";
import {
  DEFAULT_BROKER_CONFIG,
  resolveOpenClawDmScope,
  type MqttChannelConfig,
} from "./config.js";
import type { MqttInboundMessage, MqttInboundRoute } from "./types.js";
import {
  resolveInboundRoute,
  buildReplyTopicFromInbound,
  matchTopic,
} from "./topic-router.js";
import {
  getOrCreateSessionKey,
  upsertSessionContext,
} from "./session-mapper.js";
import { logAuditEvent } from "./audit.js";
import { getClientUsername } from "./broker.js";
import { isUserActionAllowed } from "./acl.js";
import { parseMessageAny } from "@partme.ai/openclaw-message-sdk";

/**
 * 处理 MQTT 入站消息（设备 -> Agent）。
 */
export async function handleInboundMessage(message: MqttInboundMessage): Promise<void> {
  const config = getMqttChannelConfig() ?? DEFAULT_BROKER_CONFIG;
  if (message.retain && !config.retain.allowInboundRetain) {
    logAuditEvent(config.audit, "warn", "inbound_retain_dropped_by_policy", {
      clientId: message.clientId,
      topic: message.topic,
    });
    return;
  }
  if (!shouldProcessTopic(message.topic, config.subscribeTopics)) {
    console.log(`[openclaw-mqtt] Ignored topic not in subscribeTopics: ${message.topic}`);
    return;
  }

  const route = resolveInboundRoute(message.topic);
  if (!route) {
    console.warn(`[openclaw-mqtt] No route matched for topic: ${message.topic}`);
    return;
  }

  const dmScope = resolveOpenClawDmScope(
    (getMqttRuntime()?.config as Record<string, unknown> | undefined) ?? {},
  );
  const sessionKey = getOrCreateSessionKey(
    message.clientId,
    route.agentId,
    route.accountId,
    dmScope,
  );
  const text = parseInboundText(message.payload, config.payload.mode);
  const replyTopic = route.replyTopic ?? buildReplyTopicFromInbound(message.topic);
  const username = getClientUsername(message.clientId);
  const user = config.auth.users.find((entry) => entry.username === username);
  if (
    user &&
    !isUserActionAllowed({
      user,
      action: "inbound",
      topic: message.topic,
      accountId: route.accountId,
    })
  ) {
    logAuditEvent(config.audit, "warn", "acl_inbound_denied", {
      clientId: message.clientId,
      username,
      topic: message.topic,
      accountId: route.accountId,
    });
    return;
  }

  upsertSessionContext(sessionKey, {
    clientId: message.clientId,
    agentId: route.agentId,
    accountId: route.accountId,
    lastInboundTopic: message.topic,
    replyTopic,
  });

  console.log(
    `[openclaw-mqtt] Inbound: client=${message.clientId}, topic=${message.topic}, agent=${route.agentId}, account=${route.accountId}, source=${route.source}, session=${sessionKey}, text=${text.slice(0, 100)}`,
  );

  try {
    await dispatchToRuntime(sessionKey, message.clientId, text, message, route, replyTopic);
  } catch (error) {
    console.error(`[openclaw-mqtt] Runtime dispatch failed for client=${message.clientId}:`, error);
  }
}

/**
 * 将入站消息分发到 OpenClaw Runtime。
 */
async function dispatchToRuntime(
  sessionKey: string,
  peerId: string,
  text: string,
  inbound: MqttInboundMessage,
  routeResult: MqttInboundRoute,
  replyTopic: string,
): Promise<void> {
  const rt = getMqttRuntime();
  if (!rt) {
    console.warn("[openclaw-mqtt] Runtime not initialized, cannot dispatch message");
    return;
  }

  const cfg = rt.config;

  const replyOptions = await rt.channel.routing.resolveAgentRoute({
    cfg,
    channel: "mqtt",
    accountId: routeResult.accountId,
    peer: { kind: "direct", id: peerId },
  });

  const ctx = await rt.channel.reply.finalizeInboundContext({
    channel: "mqtt",
    accountId: routeResult.accountId,
    from: peerId,
    text,
    chatType: "direct",
    extra: {
      topic: inbound.topic,
      qos: inbound.qos,
      retain: inbound.retain,
      dup: inbound.dup,
      messageId: inbound.messageId,
      properties: inbound.properties,
      matchedPattern: routeResult.matchedPattern,
      routeSource: routeResult.source,
    },
  });

  const dispatcher = rt.channel.reply.createReplyDispatcherWithTyping({
    deliver: async (payload: { text: string }) => {
      const { publishMessage } = await import("./broker.js");
      publishMessage(replyTopic, payload.text);
    },
  });

  await rt.channel.reply.dispatchReplyFromConfig({
    ctx,
    cfg,
    dispatcher,
    replyOptions,
  });
}

function shouldProcessTopic(topic: string, subscribeTopics: string[]): boolean {
  if (!subscribeTopics.length) {
    return true;
  }
  return subscribeTopics.some((pattern) => matchTopic(topic, pattern));
}

function parseInboundText(rawPayload: string, mode: MqttChannelConfig["payload"]["mode"]): string {
  if (mode !== "jsonTextOrPlain") {
    return rawPayload;
  }

  // Try UnifiedMessage format first
  const unifiedMsg = parseMessageAny(rawPayload);
  if (unifiedMsg && unifiedMsg.text) {
    return unifiedMsg.text;
  }

  // Fallback to existing parsing logic
  try {
    const parsed = JSON.parse(rawPayload) as { text?: unknown };
    if (typeof parsed.text === "string" && parsed.text.trim().length > 0) {
      return parsed.text;
    }
  } catch {
    // ignore parse error and fallback to plain text
  }
  return rawPayload;
}
