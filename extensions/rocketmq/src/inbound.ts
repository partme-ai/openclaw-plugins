/**
 * RocketMQ 入站消息处理：Topic/路由匹配、会话绑定、OpenClaw 分发。
 */

import { getRockermqRuntime } from "./runtime.js";
import { getRockermqChannelConfig } from "./state.js";
import { DEFAULT_ROCKERMQ_CONFIG, type RockermqConfig } from "./config.js";
import { resolveInboundRoute, buildReplyTopicFromInbound, matchTopic } from "./routing/topic-router.js";
import { upsertSessionContext } from "./routing/session-mapper.js";
import {
  createIdempotencyCache,
  type PayloadParseMode,
  type IdempotencyCache,
  type ParsedTransportPayload,
} from "@partme.ai/openclaw-message-sdk";
import {
  normalizeWireIngress,
  dispatchChannelMessage,
  resolveChannelDispatchIdentity,
  type BridgePluginRuntime,
  type ChannelDispatchMode,
} from "@partme.ai/openclaw-message-sdk/bridge";
import type { InboundEvent } from "./transport/server.js";

type InboundResult = {
  accepted: boolean;
  routeSource?: string;
  reason?: string;
};

let idempotencyCache: IdempotencyCache | undefined;
let idempotencyCacheSig = "";

function getIdempotencyCache(config: RockermqConfig): IdempotencyCache | undefined {
  if (!config.idempotency.enabled) return undefined;
  const sig = `${config.idempotency.ttlMs}:${config.idempotency.maxEntries}`;
  if (!idempotencyCache || idempotencyCacheSig !== sig) {
    idempotencyCache = createIdempotencyCache({
      ttlMs: config.idempotency.ttlMs,
      maxEntries: config.idempotency.maxEntries,
    });
    idempotencyCacheSig = sig;
  }
  return idempotencyCache;
}

function mapPayloadMode(mode: RockermqConfig["payload"]["mode"]): PayloadParseMode {
  if (mode === "plainText") return "plain";
  if (mode === "jsonOnly") return "jsonOnly";
  return "jsonTextOrPlain";
}

/**
 * 处理 RocketMQ 入站消息（设备 -> Agent）。
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
    mode: mapPayloadMode(config.payload.mode),
    channel: "rocketmq",
    idempotencyKey,
    idempotency: getIdempotencyCache(config),
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
 * 分发至 OpenClaw Runtime（message-sdk dispatchChannelMessage）。
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
    timeoutMs: params.config.dispatch.timeoutMs,
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
 * 判断 Topic 是否在订阅范围内。
 */
function shouldProcessTopic(topic: string, config: RockermqConfig): boolean {
  const subscriptions = config.consumer.subscriptions;
  if (!subscriptions.length) {
    return true;
  }
  return subscriptions.some((item) => matchTopic(topic, item.topic) || item.topic === topic);
}
