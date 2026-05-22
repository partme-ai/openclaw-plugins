/**
 * RabbitMQ 入站消息处理：Topic 过滤、路由、调用 OpenClaw reply 管线。
 */

import { getRabbitmqRuntime } from "./runtime.js";
import { getRabbitmqChannelConfig } from "./state.js";
import { DEFAULT_RABBITMQ_CONFIG, type RabbitmqConfig } from "./config.js";
import type { RabbitmqInboundRoute } from "./types.js";
import {
  resolveInboundRoute,
  buildReplyTopicFromInbound,
  matchTopic,
} from "./routing/topic-router.js";
import { upsertSessionContext } from "./routing/session-mapper.js";
import {
  createIdempotencyCache,
  type PayloadParseMode,
  type IdempotencyCache,
} from "@partme.ai/openclaw-message-sdk";
import {
  normalizeWireIngress,
  dispatchChannelMessage,
  resolveChannelDispatchIdentity,
  type BridgePluginRuntime,
  type ChannelDispatchMode,
} from "@partme.ai/openclaw-message-sdk/bridge";

import type { InboundEvent } from "./transport/server.js";

interface InboundResult {
  accepted: boolean;
  routeSource?: string;
  reason?: string;
}

let idempotencyCache: IdempotencyCache | undefined;
let idempotencyCacheSig = "";

function getIdempotencyCache(config: RabbitmqConfig): IdempotencyCache | undefined {
  if (!config.idempotency.enabled) {
    return undefined;
  }
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

function mapPayloadMode(mode: RabbitmqConfig["payload"]["mode"]): PayloadParseMode {
  if (mode === "plainText") return "plain";
  if (mode === "jsonOnly") return "jsonOnly";
  return "jsonTextOrPlain";
}

/**
 * 处理 RabbitMQ 入站消息（设备 -> Agent）。
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
    mode: mapPayloadMode(config.payload.mode),
    channel: "rabbitmq",
    idempotencyKey: correlationId,
    idempotency: getIdempotencyCache(config),
  });
  if (!parsed.accepted) {
    return { accepted: true, routeSource: "idempotency" };
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
    return { accepted: true, routeSource: route.source };
  } catch (error) {
    console.error(`[openclaw-rabbitmq] Runtime dispatch failed for peer=${route.peerId}:`, error);
    return { accepted: false, reason: `dispatch_error:${String(error)}` };
  }
}

/**
 * 将入站消息分发到 OpenClaw Runtime（message-sdk dispatchChannelMessage）。
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
    timeoutMs: config.dispatch.timeoutMs,
    replyEnabled: config.dispatch.reply.enabled,
    extra: {
      routingKey: inbound.routingKey,
      desiredAgentId: agentId,
      sessionKey,
    },
    reply: {
      deliver: async ({ wire, runId }) => {
        const { publishMessage } = await import("./transport/server.js");
        await publishMessage(replyTopic, wire, runId ? { correlationId: runId } : undefined);
      },
      outboundFormat,
      replyRoute: { routingKey: replyTopic },
      userId: sessionKey,
    },
  });
}

function shouldProcessTopic(topic: string, subscribeTopics: string[]): boolean {
  if (!subscribeTopics.length) {
    return true;
  }
  return subscribeTopics.some((pattern) => matchTopic(topic, pattern));
}
