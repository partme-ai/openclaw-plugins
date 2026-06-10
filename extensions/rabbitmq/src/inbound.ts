/**
 * @fileoverview RabbitMQ 入站消息处理编排入口。
 *
 * @description
 * 对应 Extended Profile 的入站编排层：Topic 白名单过滤、路由解析、幂等去重，
 * 并通过 message-sdk `dispatchChannelMessage` 分发至 OpenClaw reply 管线。
 *
 * @module inbound
 */

import { getRabbitmqRuntime } from "./runtime.js";
import { getRabbitmqChannelConfig } from "./state/state.js";
import { DEFAULT_RABBITMQ_CONFIG, type RabbitmqConfig } from "./config.js";
import type { RabbitmqInboundRoute } from "./types.js";
import {
  resolveInboundRoute,
  buildReplyTopicFromInbound,
  matchTopic,
} from "./routing/topic-router.js";
import { upsertSessionContext } from "./routing/session-mapper.js";
import {
  normalizeWireIngress,
  dispatchChannelMessage,
  resolveChannelDispatchIdentity,
  createDeferredDeliveryAck,
  type BridgePluginRuntime,
  type ChannelDispatchMode,
} from "@partme.ai/openclaw-message-sdk/bridge";
import type { ChannelLimitsOpenClawConfig } from "@partme.ai/openclaw-message-sdk/config";

import { resolveRabbitmqAgentReplyTimeoutMs } from "./config/resolvers.js";
import {
  getRabbitmqIdempotencyCache,
  mapRabbitmqWirePayloadMode,
} from "./shared/wire-helpers.js";
import type { InboundEvent } from "./transport/server.js";

/** @description 单条入站消息的处理结果（接受/拒绝及诊断字段）。 */
interface InboundResult {
  accepted: boolean;
  routeSource?: string;
  reason?: string;
  /** 为 true 时 transport 层不再 auto-ack（delivery 已由 inbound 显式 settle） */
  manualAck?: boolean;
}

/**
 * @description 处理单条 RabbitMQ 入站消息（设备/上游 → Agent）。
 * @param event - AMQP 消费事件
 * @param config - 通道配置
 * @returns 是否接受处理及路由来源/丢弃原因
 */
export async function processInbound(event: InboundEvent, config: RabbitmqConfig): Promise<InboundResult> {
  const cfg = getRabbitmqChannelConfig() ?? DEFAULT_RABBITMQ_CONFIG;

  if (!shouldProcessTopic(event.routingKey, config.subscribeTopics)) {
    console.log(`[openclaw-rabbitmq] Ignored topic not in subscribeTopics: ${event.routingKey}`);
    return { accepted: false, reason: "topic_not_in_subscribe_topics" };
  }

  const route = resolveInboundRoute(event.routingKey, config);
  if (!route) {
    console.warn(`[openclaw-rabbitmq] No route matched for topic: ${event.routingKey}`);
    return { accepted: false, reason: "no_route_matched" };
  }

  const correlationId =
    typeof event.properties.correlationId === "string"
      ? event.properties.correlationId
      : typeof event.properties.messageId === "string"
        ? event.properties.messageId
        : undefined;

  const parsed = normalizeWireIngress({
    rawPayload: event.content.toString("utf-8"),
    mode: mapRabbitmqWirePayloadMode(config.payload.mode),
    channel: "rabbitmq",
    idempotencyKey: correlationId,
    idempotency: getRabbitmqIdempotencyCache(config.idempotency),
  });
  if (!parsed.accepted) {
    event.delivery.ack();
    return { accepted: true, routeSource: "idempotency", manualAck: true };
  }
  const text = parsed.text;

  const replyTopic = route.replyTopic ?? buildReplyTopicFromInbound(event.routingKey, config.topicPrefix);

  const rt = getRabbitmqRuntime();
  if (!rt) {
    console.warn("[openclaw-rabbitmq] Runtime not initialized, cannot dispatch message");
    return { accepted: false, reason: "runtime_not_initialized" };
  }

  const { agentId, sessionKey } = await resolveChannelDispatchIdentity(rt as unknown as BridgePluginRuntime, {
    channel: "rabbitmq",
    accountId: route.accountId,
    peerId: route.peerId,
    agentId: route.agentId,
  });

  upsertSessionContext(sessionKey, {
    peerId: route.peerId,
    agentId,
    accountId: route.accountId,
    lastInboundTopic: event.routingKey,
    replyTopic,
    updatedAt: Date.now(),
  });

  console.log(
    `[openclaw-rabbitmq] Inbound: topic=${event.routingKey}, agent=${agentId}, account=${route.accountId}, source=${route.source}, session=${sessionKey}, bytes=${Buffer.byteLength(text, "utf-8")}`,
  );

  try {
    await dispatchToRuntime(sessionKey, route.peerId, agentId, text, event, route, replyTopic, config, parsed);
    return { accepted: true, routeSource: route.source, manualAck: true };
  } catch (error) {
    console.error(`[openclaw-rabbitmq] Runtime dispatch failed for peer=${route.peerId}:`, error);
    if (!event.delivery.settled) {
      event.delivery.nack({
        requeue: config.consume.requeueOnError,
        reason: `dispatch_error:${String(error)}`,
      });
    }
    return { accepted: false, reason: `dispatch_error:${String(error)}`, manualAck: true };
  }
}

/**
 * @description 将已解析的入站消息分发至 OpenClaw Runtime（message-sdk `dispatchChannelMessage`）。
 * @param sessionKey - OpenClaw 会话键
 * @param peerId - RabbitMQ peer 标识
 * @param agentId - 目标 Agent ID
 * @param text - 规范化后的用户文本
 * @param inbound - 原始 AMQP 入站事件
 * @param routeResult - Topic 路由命中结果
 * @param replyTopic - 回复 routing key
 * @param config - 通道配置
 * @param parsed - message-sdk 解析后的载荷
 * @returns Promise，分发失败时由上层捕获
 */
async function dispatchToRuntime(
  sessionKey: string,
  peerId: string,
  agentId: string,
  text: string,
  inbound: InboundEvent,
  routeResult: RabbitmqInboundRoute,
  replyTopic: string,
  config: RabbitmqConfig,
  parsed: import("@partme.ai/openclaw-message-sdk").ParsedTransportPayload,
): Promise<void> {
  const rt = getRabbitmqRuntime();
  if (!rt) {
    console.warn("[openclaw-rabbitmq] Runtime not initialized, cannot dispatch message");
    return;
  }

  const mode = config.dispatch.mode as ChannelDispatchMode;
  const outboundFormat = config.payload.outboundFormat ?? "envelope";
  const timeoutMs = resolveRabbitmqAgentReplyTimeoutMs(
    rt.config as ChannelLimitsOpenClawConfig,
    config.dispatch.timeoutMs,
  );

  const deferredAck = createDeferredDeliveryAck({
    delivery: inbound.delivery,
    requireReply: config.dispatch.reply.enabled,
    requeueOnMissingReply: config.consume.requeueOnError,
  });

  const baseDeliver = async ({ wire, runId }: { wire: string; runId?: string }) => {
    const { publishMessage } = await import("./transport/server.js");
    await publishMessage(replyTopic, wire, runId ? { correlationId: runId } : undefined);
  };

  try {
    await dispatchChannelMessage({
      mode,
      runtime: rt as unknown as BridgePluginRuntime,
      channel: "rabbitmq",
      accountId: routeResult.accountId,
      peerId,
      text,
      agentId,
      sessionKey,
      unified: parsed.unified,
      sessionId: `rabbitmq:${routeResult.accountId}:${routeResult.agentId}:${peerId}`,
      timeoutMs,
      replyEnabled: config.dispatch.reply.enabled,
      extra: {
        routingKey: inbound.routingKey,
        desiredAgentId: agentId,
        sessionKey,
      },
      reply: {
        deliver: deferredAck.wrapReplyDeliver(baseDeliver),
        outboundFormat,
        replyRoute: { routingKey: replyTopic },
        userId: sessionKey,
      },
    });
    deferredAck.finalizeAfterDispatch();
  } catch (error) {
    deferredAck.nackOnFailure(config.consume.requeueOnError, "reply_publish_or_dispatch_failed");
    throw error;
  }
}

/**
 * @description 判断 routing key 是否落在 `subscribeTopics` 白名单内；空白名单表示接受全部。
 * @param topic - 入站 routing key
 * @param subscribeTopics - 订阅模式列表（支持 * / # 通配符）
 * @returns 是否应继续处理
 */
function shouldProcessTopic(topic: string, subscribeTopics: string[]): boolean {
  if (!subscribeTopics.length) {
    return true;
  }
  return subscribeTopics.some((pattern) => matchTopic(topic, pattern));
}
