/**
 * @module mqtt/inbound
 *
 * MQTT 入站消息处理：Topic 过滤、路由、调用 OpenClaw reply 管线。
 */

import { getMqttRuntime } from "./runtime.js";
import { getMqttChannelConfig } from "./state/mqtt-state.js";
import {
  DEFAULT_BROKER_CONFIG,
  type MqttChannelConfig,
} from "./config.js";
import type { MqttInboundMessage, MqttInboundRoute } from "./types.js";
import {
  resolveInboundRoute,
  buildReplyTopicFromInbound,
  matchTopic,
} from "./routing/topic-router.js";
import { upsertSessionContext } from "./routing/session-mapper.js";
import { logAuditEvent } from "./transport/audit.js";
import { getClientUsername, publishMessage } from "./transport/server.js";
import { isUserActionAllowed } from "./transport/acl.js";
import {
  normalizeWireIngress,
  dispatchChannelMessage,
  resolveChannelDispatchIdentity,
  type BridgePluginRuntime,
} from "@partme.ai/openclaw-message-sdk/bridge";
import { getMqttIdempotencyCache } from "./shared/wire-helpers.js";

/** MQTT 入站幂等缓存（messageId / 等价键）。 */
const idempotencyCache = getMqttIdempotencyCache();

/**
 * 处理 MQTT 入站消息（设备 → Agent）：Topic 过滤、路由、ACL、message-sdk dispatch。
 *
 * @param message - Aedes 解析后的入站 MQTT 消息（含 clientId、topic、payload、qos 等）
 * @returns 完成 dispatch 或 policy 丢弃后 resolve；错误仅记录日志不抛出
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

  const rt = getMqttRuntime();
  if (!rt) {
    console.warn("[openclaw-mqtt] Runtime not initialized, cannot dispatch message");
    return;
  }

  const peerId = message.clientId;
  const { agentId, sessionKey } = await resolveChannelDispatchIdentity(rt as unknown as BridgePluginRuntime, {
    channel: "mqtt",
    accountId: route.accountId,
    peerId,
    agentId: route.agentId,
  });

  const idempotencyKey =
    message.messageId !== undefined ? String(message.messageId) : undefined;
  const parsed = normalizeWireIngress({
    rawPayload: message.payload,
    mode: config.payload.mode,
    channel: "mqtt",
    idempotencyKey,
    idempotency: idempotencyKey ? idempotencyCache : undefined,
  });
  if (!parsed.accepted) {
    console.log(`[openclaw-mqtt] Duplicate inbound dropped: ${message.messageId}`);
    return;
  }
  const text = parsed.text;
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
    agentId,
    accountId: route.accountId,
    lastInboundTopic: message.topic,
    replyTopic,
  });

  console.log(
    `[openclaw-mqtt] Inbound: client=${message.clientId}, topic=${message.topic}, agent=${agentId}, account=${route.accountId}, source=${route.source}, session=${sessionKey}, text=${text.slice(0, 100)}`,
  );

  try {
    await dispatchToRuntime(sessionKey, peerId, agentId, text, message, route, replyTopic, parsed.unified);
  } catch (error) {
    console.error(`[openclaw-mqtt] Runtime dispatch failed for client=${message.clientId}:`, error);
  }
}

/**
 * 将入站消息经 message-sdk `dispatchChannelMessage` 分发到 OpenClaw reply 管线。
 *
 * @param sessionKey - OpenClaw session 键
 * @param peerId - 对端标识（MQTT clientId）
 * @param agentId - 目标 Agent id
 * @param text - 解析后的入站文本
 * @param inbound - 原始 MQTT 入站消息
 * @param routeResult - Topic 路由结果
 * @param replyTopic - 出站回复 Topic
 * @param unified - 可选 UnifiedMessage（供 enrich dispatch）
 */
async function dispatchToRuntime(
  sessionKey: string,
  peerId: string,
  agentId: string,
  text: string,
  inbound: MqttInboundMessage,
  routeResult: MqttInboundRoute,
  replyTopic: string,
  unified: import("@partme.ai/openclaw-message-sdk").UnifiedMessage | null,
): Promise<void> {
  const rt = getMqttRuntime();
  if (!rt) {
    console.warn("[openclaw-mqtt] Runtime not initialized, cannot dispatch message");
    return;
  }

  const outboundFormat = getMqttChannelConfig()?.payload?.outboundFormat ?? "envelope";

  await dispatchChannelMessage({
    mode: "reply-pipeline",
    runtime: rt as unknown as BridgePluginRuntime,
    channel: "mqtt",
    accountId: routeResult.accountId,
    peerId,
    text,
    agentId,
    sessionKey,
    unified,
    extra: {
      topic: inbound.topic,
      qos: inbound.qos,
      retain: inbound.retain,
      dup: inbound.dup,
      messageId: inbound.messageId,
      properties: inbound.properties,
      matchedPattern: routeResult.matchedPattern,
      routeSource: routeResult.source,
      sessionKey,
    },
    reply: {
      deliver: async ({ wire }: { wire: Uint8Array | string }) => {
        const payload = typeof wire === "string" ? wire : Buffer.from(wire).toString("utf8");
        publishMessage(replyTopic, payload);
      },
      outboundFormat,
      replyRoute: { topic: replyTopic },
      agentId,
    },
  });
}

/** 判断 topic 是否匹配 subscribeTopics；列表为空时接受全部。 */
function shouldProcessTopic(topic: string, subscribeTopics: string[]): boolean {
  if (!subscribeTopics.length) {
    return true;
  }
  return subscribeTopics.some((pattern) => matchTopic(topic, pattern));
}
