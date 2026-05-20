/**
 * RabbitMQ 入站消息处理：Topic 过滤、路由、调用 OpenClaw reply 管线。
 */

import { getRabbitmqRuntime } from "./runtime.js";
import { getRabbitmqChannelConfig } from "./rabbitmq-state.js";
import { DEFAULT_RABBITMQ_CONFIG, type RabbitmqConfig } from "./rabbitmq-config.js";
import type { RabbitmqInboundRoute } from "./types.js";
import {
  resolveInboundRoute,
  buildReplyTopicFromInbound,
  matchTopic,
} from "./topic-router.js";
import {
  upsertSessionContext,
  getOrCreateSessionKey,
} from "./session-mapper.js";
import { randomUUID } from "node:crypto";
import { parseMessageAny } from "@partme.ai/openclaw-message-sdk";

import type { InboundEvent } from "./rabbitmq-server.js";

interface InboundResult {
  accepted: boolean;
  routeSource?: string;
  reason?: string;
}

const seenIdempotencyKeys = new Map<string, number>();

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

  const parsed = parseInboundText(event.content.toString("utf-8"), config.payload.mode);
  const text = parsed.text;
  const correlationId =
    parsed.correlationId ??
    (typeof event.properties.correlationId === "string" ? event.properties.correlationId : undefined) ??
    (typeof event.properties.messageId === "string" ? event.properties.messageId : undefined);

  if (config.idempotency.enabled) {
    const key = parsed.idempotencyKey ?? correlationId;
    if (key) {
      const now = Date.now();
      pruneIdempotency(now, config.idempotency.ttlMs, config.idempotency.maxEntries);
      const existing = seenIdempotencyKeys.get(key);
      if (existing && existing > now) {
        return { accepted: true, routeSource: "idempotency" };
      }
      seenIdempotencyKeys.set(key, now + config.idempotency.ttlMs);
    }
  }

  const replyTopic = route.replyTopic ?? buildReplyTopicFromInbound(event.routingKey, config.topicPrefix);

  const rt = getRabbitmqRuntime();
  const runtimeCfg = (rt?.config ?? {}) as Record<string, unknown>;
  const sessionKey = getOrCreateSessionKey({
    cfg: runtimeCfg,
    peerId: route.peerId,
    agentId: route.agentId,
    accountId: route.accountId,
    channel: "rabbitmq",
  });

  upsertSessionContext(sessionKey, {
    peerId: route.peerId,
    agentId: route.agentId,
    accountId: route.accountId,
    lastInboundTopic: event.routingKey,
    replyTopic,
    updatedAt: Date.now(),
  });

  console.log(
    `[openclaw-rabbitmq] Inbound: topic=${event.routingKey}, agent=${route.agentId}, account=${route.accountId}, source=${route.source}, session=${sessionKey}, bytes=${Buffer.byteLength(text, "utf-8")}`,
  );

  try {
    await dispatchToRuntime(sessionKey, route.peerId, text, event, route, replyTopic, config);
    return { accepted: true, routeSource: route.source };
  } catch (error) {
    console.error(`[openclaw-rabbitmq] Runtime dispatch failed for peer=${route.peerId}:`, error);
    return { accepted: false, reason: `dispatch_error:${String(error)}` };
  }
}

/**
 * 将入站消息分发到 OpenClaw Runtime。
 */
async function dispatchToRuntime(
  sessionKey: string,
  peerId: string,
  text: string,
  inbound: InboundEvent,
  routeResult: RabbitmqInboundRoute,
  replyTopic: string,
  config: RabbitmqConfig,
): Promise<void> {
  const rt = getRabbitmqRuntime();
  if (!rt) {
    console.warn("[openclaw-rabbitmq] Runtime not initialized, cannot dispatch message");
    return;
  }

  const cfg = rt.config;
  if (config.dispatch.mode === "embedded-agent") {
    await dispatchViaEmbeddedAgent({
      rt,
      cfg,
      sessionKey,
      sessionId: `rabbitmq:${routeResult.accountId}:${routeResult.agentId}:${peerId}`,
      agentId: routeResult.agentId,
      prompt: text,
      timeoutMs: config.dispatch.timeoutMs,
      replyTopic,
    });
    return;
  }
  if (config.dispatch.mode === "subagent") {
    await dispatchViaSubagent({
      rt,
      sessionKey,
      agentId: routeResult.agentId,
      prompt: text,
      timeoutMs: config.dispatch.timeoutMs,
      replyTopic,
      replyEnabled: config.dispatch.reply.enabled,
    });
    return;
  }

  const replyOptions = await rt.channel.routing.resolveAgentRoute({
    cfg,
    channel: "rabbitmq",
    accountId: routeResult.accountId,
    peer: { kind: "direct", id: peerId },
  });

  const ctx = await rt.channel.reply.finalizeInboundContext({
    channel: "rabbitmq",
    accountId: routeResult.accountId,
    from: peerId,
    text,
    chatType: "direct",
    extra: {
      routingKey: inbound.routingKey,
      desiredAgentId: routeResult.agentId,
    },
  });

  const dispatcher = createReplyDispatcher(replyTopic);

  await rt.channel.reply.dispatchReplyFromConfig({
    ctx,
    cfg,
    dispatcher,
    replyOptions,
  });
}

/**
 * 创建 ReplyDispatcher。
 */
function createReplyDispatcher(replyTopic: string) {
  return {
    deliver: async (payload: { text: string }) => {
      const { publishMessage } = await import("./rabbitmq-server.js");
      publishMessage(replyTopic, payload.text);
    },
  };
}

async function dispatchViaEmbeddedAgent(params: {
  rt: any;
  cfg: Record<string, unknown>;
  sessionKey: string;
  sessionId: string;
  agentId: string;
  prompt: string;
  timeoutMs: number;
  replyTopic: string;
}): Promise<void> {
  const agentDir = await params.rt.agent.resolveAgentDir(params.cfg, params.agentId);
  const workspaceDir = params.rt.agent.resolveAgentWorkspaceDir(params.cfg, params.agentId);
  const sessionFile = `${agentDir}/sessions/${sanitizeSessionId(params.sessionId)}.jsonl`;
  const runId = cryptoRandom();
  const result = await params.rt.agent.runEmbeddedAgent({
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    sessionFile,
    workspaceDir,
    prompt: params.prompt,
    timeoutMs: params.timeoutMs,
    runId,
    config: params.cfg,
  });
  const text = extractFinalTextFromRunResult(result);
  if (text.trim().length === 0) {
    return;
  }
  const { publishMessage } = await import("./rabbitmq-server.js");
  await publishMessage(params.replyTopic, JSON.stringify({ text }), {
    correlationId: runId,
  });
}

async function dispatchViaSubagent(params: {
  rt: any;
  sessionKey: string;
  agentId: string;
  prompt: string;
  timeoutMs: number;
  replyTopic: string;
  replyEnabled: boolean;
}): Promise<void> {
  const childSessionKey = `agent:${params.agentId}:subagent:rabbitmq:${sanitizeSessionId(params.sessionKey)}`;
  const { runId } = await params.rt.subagent.run({
    sessionKey: childSessionKey,
    message: params.prompt,
    deliver: false,
  });
  if (!params.replyEnabled) {
    return;
  }
  const result = await params.rt.subagent.waitForRun({ runId, timeoutMs: params.timeoutMs });
  const text =
    typeof result?.text === "string"
      ? result.text
      : typeof result?.message === "string"
        ? result.message
        : JSON.stringify(result ?? {});
  const { publishMessage } = await import("./rabbitmq-server.js");
  await publishMessage(params.replyTopic, JSON.stringify({ text }), {
    correlationId: runId,
  });
}

function extractFinalTextFromRunResult(result: any): string {
  const payloads = Array.isArray(result?.payloads) ? result.payloads : [];
  const texts = payloads
    .filter((p: any) => p && typeof p.text === "string" && p.isReasoning !== true)
    .map((p: any) => p.text as string);
  return texts.join("\n");
}

function sanitizeSessionId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._:-]+/g, "_").slice(0, 128);
}

function cryptoRandom(): string {
  return randomUUID();
}

function shouldProcessTopic(topic: string, subscribeTopics: string[]): boolean {
  if (!subscribeTopics.length) {
    return true;
  }
  return subscribeTopics.some((pattern) => matchTopic(topic, pattern));
}

function parseInboundText(rawPayload: string, mode: RabbitmqConfig["payload"]["mode"]): {
  text: string;
  correlationId?: string;
  idempotencyKey?: string;
} {
  if (mode === "plainText") {
    return { text: rawPayload };
  }
  if (mode === "jsonOnly") {
    // Try UnifiedMessage format first
    const unifiedMsg = parseMessageAny(rawPayload);
    if (unifiedMsg && unifiedMsg.text) {
      return {
        text: unifiedMsg.text,
        correlationId: typeof unifiedMsg.metadata?.correlationId === "string" ? unifiedMsg.metadata.correlationId : undefined,
        idempotencyKey: typeof unifiedMsg.metadata?.idempotencyKey === "string" ? unifiedMsg.metadata.idempotencyKey : undefined,
      };
    }

    try {
      const parsed = JSON.parse(rawPayload) as any;
      const text = typeof parsed?.text === "string" ? parsed.text : JSON.stringify(parsed ?? {});
      return {
        text,
        correlationId: typeof parsed?.correlationId === "string" ? parsed.correlationId : undefined,
        idempotencyKey: typeof parsed?.idempotencyKey === "string" ? parsed.idempotencyKey : undefined,
      };
    } catch {
      return { text: "" };
    }
  }
  // Try UnifiedMessage format first
  const unifiedMsg = parseMessageAny(rawPayload);
  if (unifiedMsg && unifiedMsg.text) {
    return {
      text: unifiedMsg.text,
      correlationId: typeof unifiedMsg.metadata?.correlationId === "string" ? unifiedMsg.metadata.correlationId : undefined,
      idempotencyKey: typeof unifiedMsg.metadata?.idempotencyKey === "string" ? unifiedMsg.metadata.idempotencyKey : undefined,
    };
  }

  try {
    const parsed = JSON.parse(rawPayload) as any;
    if (typeof parsed?.text === "string" && parsed.text.trim().length > 0) {
      return {
        text: parsed.text,
        correlationId: typeof parsed?.correlationId === "string" ? parsed.correlationId : undefined,
        idempotencyKey: typeof parsed?.idempotencyKey === "string" ? parsed.idempotencyKey : undefined,
      };
    }
    return {
      text: rawPayload,
      correlationId: typeof parsed?.correlationId === "string" ? parsed.correlationId : undefined,
      idempotencyKey: typeof parsed?.idempotencyKey === "string" ? parsed.idempotencyKey : undefined,
    };
  } catch {
    return { text: rawPayload };
  }
}

function pruneIdempotency(now: number, ttlMs: number, maxEntries: number): void {
  if (seenIdempotencyKeys.size <= maxEntries) {
    for (const [k, exp] of seenIdempotencyKeys) {
      if (exp <= now) {
        seenIdempotencyKeys.delete(k);
      }
    }
    return;
  }
  for (const [k, exp] of seenIdempotencyKeys) {
    if (exp <= now) {
      seenIdempotencyKeys.delete(k);
    }
  }
  while (seenIdempotencyKeys.size > maxEntries) {
    const first = seenIdempotencyKeys.keys().next().value as string | undefined;
    if (!first) break;
    seenIdempotencyKeys.delete(first);
  }
}
