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
import { publishMessage } from "./transport/server.js";
import { isUserActionAllowed } from "./transport/acl.js";
import {
  normalizeWireIngress,
  dispatchChannelMessage,
  requireSettledDelivery,
  resolveChannelDispatchIdentity,
  type BridgePluginRuntime,
} from "@partme.ai/openclaw-message-sdk/bridge";
import { redactMqttError } from "./shared/redact.js";
import { createHash } from "node:crypto";

/** Packet IDs are reused after PUBACK; durable custody requires an application ID. */
function resolveApplicationDeliveryIdentity(message: MqttInboundMessage, authenticated: boolean): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(message.payload).toString("utf8")) as Record<string, unknown>;
    const nested = typeof payload.message === "object" && payload.message ? payload.message as Record<string, unknown> : undefined;
    const headers = typeof payload.headers === "object" && payload.headers ? payload.headers as Record<string, unknown> : undefined;
    const candidate = payload.idempotencyKey ?? payload.messageId ?? nested?.messageId ?? headers?.idempotencyKey;
    if (typeof candidate !== "string" || !candidate.trim()) return undefined;
    return createHash("sha256").update(JSON.stringify([
      authenticated ? message.authenticatedUsername : "local", message.clientId, candidate.trim(),
    ])).digest("hex");
  } catch {
    return undefined;
  }
}

/**
 * 处理 MQTT 入站消息（设备 → Agent）：Topic 过滤、路由、ACL、message-sdk dispatch。
 *
 * @param message - Aedes 解析后的入站 MQTT 消息（含 clientId、topic、payload、qos 等）
 * @returns 完成 dispatch 或 policy 丢弃后 resolve；运行时 dispatch 失败时向上抛出
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
    console.log(`[openclaw-mqtt] Ignored topic not in subscribeTopics: ${redactMqttError(message.topic, config)}`);
    return;
  }

  const route = resolveInboundRoute(message.topic);
  if (!route) {
    console.warn(`[openclaw-mqtt] No route matched for topic: ${redactMqttError(message.topic, config)}`);
    return;
  }

  const rt = getMqttRuntime();
  if (!rt) {
    throw new Error("Runtime not initialized, cannot dispatch MQTT message");
  }

  const peerId = message.clientId;
  const { agentId, sessionKey } = await resolveChannelDispatchIdentity(rt as unknown as BridgePluginRuntime, {
    channel: "mqtt",
    accountId: route.accountId,
    peerId,
    agentId: route.agentId,
  });

  const parsed = normalizeWireIngress({
    rawPayload: message.payload,
    mode: config.payload.mode,
    channel: "mqtt",
  });
  if (!parsed.accepted) {
    throw new Error("MQTT inbound was rejected before durable delivery settlement");
  }
  const text = parsed.text;
  const replyTopic = route.replyTopic ?? buildReplyTopicFromInbound(message.topic);
  const username = message.authenticatedUsername;
  const user = config.auth.users.find((entry) => entry.username === username);
  if (
    config.auth.enabled &&
    (!user ||
      !isUserActionAllowed({
        user,
        action: "inbound",
        topic: message.topic,
        accountId: route.accountId,
      }))
  ) {
    logAuditEvent(config.audit, "warn", user ? "acl_inbound_denied" : "acl_inbound_identity_missing", {
      clientId: message.clientId,
      username: username ?? null,
      topic: message.topic,
      accountId: route.accountId,
    });
    return;
  }

  const deliveryIdentity = resolveApplicationDeliveryIdentity(message, config.auth.enabled);

  upsertSessionContext(sessionKey, {
    clientId: message.clientId,
    agentId,
    accountId: route.accountId,
    lastInboundTopic: message.topic,
    replyTopic,
  });

  // 消息正文属于业务数据，生产日志只记录长度；路由标识统一经过最终脱敏边界。
  console.log(redactMqttError(
    `[openclaw-mqtt] Inbound: client=${message.clientId}, topic=${message.topic}, agent=${agentId}, account=${route.accountId}, source=${route.source}, session=${sessionKey}, textLength=${text.length}`,
    config,
  ));

  try {
    await dispatchToRuntime(sessionKey, peerId, agentId, text, message, route, replyTopic, parsed.unified, deliveryIdentity);
  } catch (error) {
    console.error(redactMqttError(
      `[openclaw-mqtt] Runtime dispatch failed for client=${message.clientId}: ${error instanceof Error ? error.message : String(error)}`,
      config,
    ));
    // 必须继续抛出：上层 authorizePublish 只有感知失败，才能拒绝 PUBACK，
    // 避免客户端认为消息已经被 Agent 成功处理。
    throw error;
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
  deliveryIdentity: string | undefined,
): Promise<void> {
  const rt = getMqttRuntime();
  if (!rt) {
    throw new Error("Runtime not initialized, cannot dispatch MQTT message");
  }

  const outboundFormat = getMqttChannelConfig()?.payload?.outboundFormat ?? "envelope";

  const dispatchResult = await dispatchChannelMessage({
    deliveryIdentity,
    requireDeliveryIdentity: Boolean(deliveryIdentity),
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
        await publishMessage(replyTopic, payload);
      },
      outboundFormat,
      structuredMediaHosts: getMqttChannelConfig()?.payload?.structuredMediaHosts,
      replyRoute: { topic: replyTopic },
      agentId,
    },
  });
  requireSettledDelivery(dispatchResult?.deliveryOutcome);
}

/** 判断 topic 是否匹配 subscribeTopics；列表为空时接受全部。 */
function shouldProcessTopic(topic: string, subscribeTopics: string[]): boolean {
  if (!subscribeTopics.length) {
    return true;
  }
  return subscribeTopics.some((pattern) => matchTopic(topic, pattern));
}
