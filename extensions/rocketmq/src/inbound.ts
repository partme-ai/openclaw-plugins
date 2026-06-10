/**
 * @fileoverview RocketMQ 入站编排：Topic/Tag 路由、幂等、会话绑定与 OpenClaw 分发。
 *
 * @description
 * PushConsumer 回调经 `processInbound` 进入本模块：校验订阅范围 → 解析路由 →
 * message-sdk `normalizeWireIngress` → `dispatchChannelMessage` 驱动 Agent；
 * 出站回复经 transport `publishMessage` 写回 reply Topic。
 *
 * @module inbound
 */

/**
 * RocketMQ 入站 — Base Profile 入口。
 */

import { getRockermqRuntime } from "./runtime.js";
import { getRockermqChannelConfig } from "./state/state.js";
import { DEFAULT_ROCKERMQ_CONFIG, type RockermqConfig } from "./config.js";
import { resolveInboundRoute, buildReplyTopicFromInbound, matchTopic } from "./routing/topic-router.js";
import { upsertSessionContext } from "./routing/session-mapper.js";
import type { ParsedTransportPayload } from "@partme.ai/openclaw-message-sdk";
import {
  normalizeWireIngress,
  dispatchChannelMessage,
  resolveChannelDispatchIdentity,
  type BridgePluginRuntime,
  type ChannelDispatchMode,
} from "@partme.ai/openclaw-message-sdk/bridge";
import type { ChannelLimitsOpenClawConfig } from "@partme.ai/openclaw-message-sdk/config";

import { resolveRocketmqAgentReplyTimeoutMs } from "./config/resolvers.js";
import {
  getRocketmqIdempotencyCache,
  mapRocketmqWirePayloadMode,
} from "./shared/wire-helpers.js";
import type { InboundEvent } from "./transport/server.js";

type InboundResult = {
  accepted: boolean;
  routeSource?: string;
  reason?: string;
};

/**
 * @description 处理 RocketMQ 入站消息（设备 / 上游 → Agent）。
 * @param event - PushConsumer 归一化后的入站事件。
 * @param config - 当前生效的 RocketMQ 配置。
 * @returns 是否接受及路由来源 / 丢弃原因。
 * @throws 不抛出；内部 dispatch 异常转为 `{ accepted: false, reason }`。
 */
export async function processInbound(
  event: InboundEvent,
  config: RockermqConfig,
): Promise<InboundResult> {
  if (!shouldProcessTopic(event.topic, config)) {
    console.log(`[openclaw-rocketmq] Ignored topic not in subscriptions: ${event.topic}`);
    return { accepted: false, reason: "topic_not_in_subscriptions" };
  }

  const route = resolveInboundRoute(event.topic, event.tag, config);
  if (!route) {
    console.warn(
      `[openclaw-rocketmq] No route matched for topic=${event.topic} tag=${event.tag ?? "*"}`,
    );
    return { accepted: false, reason: "no_route_matched" };
  }

  const idempotencyKey = event.messageId ?? event.keys?.[0];

  const parsed = normalizeWireIngress({
    rawPayload: event.body.toString("utf-8"),
    mode: mapRocketmqWirePayloadMode(config.payload.mode),
    channel: "rocketmq",
    idempotencyKey,
    idempotency: getRocketmqIdempotencyCache(config.idempotency),
  });
  if (!parsed.accepted) {
    return { accepted: true, routeSource: "idempotency" };
  }
  const text = parsed.text;

  const rt = getRockermqRuntime();
  if (!rt) {
    return { accepted: false, reason: "runtime_not_initialized" };
  }
  const peerId = route.peerId || event.topic;

  const { agentId, sessionKey } = await resolveChannelDispatchIdentity(rt as unknown as BridgePluginRuntime, {
    channel: "rocketmq",
    accountId: route.accountId,
    peerId,
    agentId: route.agentId,
  });

  const replyTopic =
    route.replyTopic ??
    buildReplyTopicFromInbound(
      event.topic,
      getRockermqChannelConfig()?.topicPrefix ?? DEFAULT_ROCKERMQ_CONFIG.topicPrefix,
    );

  console.log(
    `[openclaw-rocketmq] Inbound: topic=${event.topic}, tag=${event.tag ?? "*"}, agent=${agentId}, account=${route.accountId}, source=${route.source}, session=${sessionKey}, bytes=${Buffer.byteLength(text, "utf-8")}`,
  );

  upsertSessionContext(sessionKey, {
    peerId,
    agentId,
    accountId: route.accountId,
    lastInboundTopic: event.topic,
    lastInboundTag: event.tag,
    replyTopic,
    replyTag: route.replyTag,
    updatedAt: Date.now(),
  });

  try {
    await dispatchToRuntime({
      sessionKey,
      peerId: route.peerId || event.topic,
      agentId,
      accountId: route.accountId,
      prompt: text,
      replyTopic,
      replyTag: route.replyTag,
      config,
      parsed,
    });
    return { accepted: true, routeSource: route.source };
  } catch (error) {
    console.error(
      `[openclaw-rocketmq] Runtime dispatch failed for peer=${route.peerId || event.topic}:`,
      error,
    );
    return { accepted: false, reason: `dispatch_error:${String(error)}` };
  }
}

/**
 * @description 经 message-sdk `dispatchChannelMessage` 分发至 OpenClaw Runtime 并注册 MQ 回复 deliver。
 * @param params - 会话、路由、prompt 与解析结果。
 * @returns Promise，成功时无返回值。
 * @throws 底层 dispatch 或 publish 失败时向上抛出。
 */
async function dispatchToRuntime(params: {
  sessionKey: string;
  peerId: string;
  agentId: string;
  accountId: string;
  prompt: string;
  replyTopic: string;
  replyTag?: string;
  config: RockermqConfig;
  parsed: ParsedTransportPayload;
}): Promise<void> {
  const rt = getRockermqRuntime();
  if (!rt) {
    console.warn("[openclaw-rocketmq] Runtime not initialized, cannot dispatch message");
    return;
  }

  const mode = params.config.dispatch.mode as ChannelDispatchMode;
  const timeoutMs = resolveRocketmqAgentReplyTimeoutMs(
    rt.config as ChannelLimitsOpenClawConfig,
    params.config.dispatch.timeoutMs,
  );

  await dispatchChannelMessage({
    mode,
    runtime: rt as unknown as BridgePluginRuntime,
    channel: "rocketmq",
    accountId: params.accountId,
    peerId: params.peerId,
    text: params.prompt,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    unified: params.parsed.unified,
    sessionId: `rocketmq:${params.accountId ?? "default"}:${params.agentId}:${params.peerId}`,
    timeoutMs,
    replyEnabled: params.config.dispatch.reply.enabled,
    extra: {
      topic: params.replyTopic,
      desiredAgentId: params.agentId,
      sessionKey: params.sessionKey,
    },
    reply: {
      deliver: async ({ wire }) => {
        const { publishMessage } = await import("./transport/server.js");
        await publishMessage({
          topic: params.replyTopic,
          tag: params.replyTag,
          payload: wire,
          endpoints: params.config.endpoints,
          namespace: params.config.namespace,
          sessionCredentials: params.config.sessionCredentials,
        });
      },
      outboundFormat: mode === "reply-pipeline" ? "envelope" : "legacyJsonText",
      replyRoute: { topic: params.replyTopic },
      userId: mode === "subagent" ? params.sessionKey : params.peerId,
    },
  });
}

/**
 * @description 判断 Topic 是否在 consumer.subscriptions 允许范围内（空列表表示全放行）。
 * @param topic - 实际 Topic 名。
 * @param config - 当前配置。
 * @returns 是否应处理该 Topic。
 * @throws 不抛出。
 */
function shouldProcessTopic(topic: string, config: RockermqConfig): boolean {
  const subscriptions = config.consumer.subscriptions;
  if (!subscriptions.length) {
    return true;
  }
  return subscriptions.some((item) => matchTopic(topic, item.topic) || item.topic === topic);
}
