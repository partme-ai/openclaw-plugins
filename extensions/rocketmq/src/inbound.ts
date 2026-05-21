/**
 * RocketMQ 入站消息处理：Topic/路由匹配、会话绑定、OpenClaw 分发。
 */

import { randomBytes } from "node:crypto";
import { getRockermqRuntime } from "./runtime.js";
import { getRockermqChannelConfig } from "./rocketmq-state.js";
import { DEFAULT_ROCKERMQ_CONFIG, type RockermqConfig } from "./rocketmq-config.js";
import { resolveInboundRoute, buildReplyTopicFromInbound, matchTopic } from "./topic-router.js";
import { upsertSessionContext } from "./session-mapper.js";
import { parseMessageAny } from "@partme.ai/openclaw-message-sdk";
import type { InboundEvent } from "./rocketmq-server.js";

type InboundResult = {
  accepted: boolean;
  routeSource?: string;
  reason?: string;
};

const seenIdempotencyKeys = new Map<string, number>();

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

  const parsed = parseInboundText(event.body.toString("utf-8"), config.payload.mode);
  const text = parsed.text;
  const correlationId = parsed.correlationId ?? event.messageId;

  if (config.idempotency.enabled) {
    const key = correlationId;
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

  const rt = getRockermqRuntime();
  const peerId = route.peerId || event.topic;

  // 使用 OpenClaw 核心 resolveAgentRoute 生成 session key（与飞书等渠道一致）
  const agentRoute = rt?.channel?.routing?.resolveAgentRoute
    ? await rt.channel.routing.resolveAgentRoute({
        cfg: rt.config,
        channel: "rocketmq",
        accountId: route.accountId,
        peer: { kind: "direct", id: peerId },
      })
    : null;
  const sessionKey = agentRoute?.sessionKey?.trim() || `agent:${route.agentId}:main`;

  const replyTopic =
    route.replyTopic ??
    buildReplyTopicFromInbound(
      event.topic,
      getRockermqChannelConfig()?.topicPrefix ?? DEFAULT_ROCKERMQ_CONFIG.topicPrefix,
    );

  console.log(
    `[openclaw-rocketmq] Inbound: topic=${event.topic}, tag=${event.tag ?? "*"}, agent=${route.agentId}, account=${route.accountId}, source=${route.source}, session=${sessionKey}, bytes=${Buffer.byteLength(text, "utf-8")}`,
  );

  // 保存 session 上下文（仅用于出站 replyTopic 路由，session key 由 OpenClaw 核心管理）
  upsertSessionContext(sessionKey, {
    peerId,
    agentId: route.agentId,
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
      agentId: route.agentId,
      accountId: route.accountId,
      prompt: text,
      replyTopic,
      replyTag: route.replyTag,
      config,
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
 * 分发至 OpenClaw Runtime。
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
}): Promise<void> {
  const rt = getRockermqRuntime();
  if (!rt) {
    console.warn("[openclaw-rocketmq] Runtime not initialized, cannot dispatch message");
    return;
  }

  if (params.config.dispatch.mode === "embedded-agent") {
    await dispatchViaEmbeddedAgent(rt, params);
    return;
  }
  if (params.config.dispatch.mode === "subagent") {
    await dispatchViaSubagent(rt, params);
    return;
  }

  const replyOptions = await rt.channel.routing.resolveAgentRoute({
    cfg: rt.config,
    channel: "rocketmq",
    accountId: params.accountId,
    peer: { kind: "direct", id: params.peerId },
  });

  const ctx = await rt.channel.reply.finalizeInboundContext({
    channel: "rocketmq",
    accountId: params.accountId,
    from: params.peerId,
    text: params.prompt,
    chatType: "direct",
    extra: {
      topic: params.replyTopic,
      desiredAgentId: params.agentId,
    },
  });

  await rt.channel.reply.dispatchReplyFromConfig({
    ctx,
    cfg: rt.config,
    replyOptions,
    dispatcher: {
      deliver: async (payload: { text: string }) => {
        const { publishMessage } = await import("./rocketmq-server.js");
        await publishMessage({
          topic: params.replyTopic,
          tag: params.replyTag,
          payload: JSON.stringify({ text: payload.text }),
        });
      },
      sendFinalReply: async (payload: { text: string }) => {
        const { publishMessage } = await import("./rocketmq-server.js");
        await publishMessage({
          topic: params.replyTopic,
          tag: params.replyTag,
          payload: JSON.stringify({ text: payload.text }),
        });
      },
      getQueuedCounts: () => ({ queued: 0, pending: 0 }),
    },
  });
}

/**
 * 通过 embedded agent 执行。
 */
async function dispatchViaEmbeddedAgent(
  rt: any,
  params: {
    sessionKey: string;
    peerId: string;
    agentId: string;
    accountId: string;
    prompt: string;
    replyTopic: string;
    replyTag?: string;
    config: RockermqConfig;
  },
): Promise<void> {
  const agentDir = await rt.agent.resolveAgentDir(rt.config, params.agentId);
  const workspaceDir = rt.agent.resolveAgentWorkspaceDir(rt.config, params.agentId);
  const sessionId = `rocketmq:${params.accountId ?? "default"}:${params.agentId}:${params.peerId}`;
  const runId = cryptoRandom();
  const result = await rt.agent.runEmbeddedAgent({
    sessionId,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    sessionFile: `${agentDir}/sessions/${sanitizeSessionId(sessionId)}.jsonl`,
    workspaceDir,
    prompt: params.prompt,
    timeoutMs: params.config.dispatch.timeoutMs,
    runId,
    config: rt.config,
  });
  const text = extractFinalTextFromRunResult(result);
  if (!text.trim()) {
    return;
  }
  try {
    const { publishMessage } = await import("./rocketmq-server.js");
    await publishMessage({
      topic: params.replyTopic,
      tag: params.replyTag,
      payload: JSON.stringify({ text }),
      endpoints: params.config.endpoints,
      namespace: params.config.namespace,
      sessionCredentials: params.config.sessionCredentials,
    });
  } catch (err) {
    console.warn(
      `[openclaw-rocketmq] Failed to publish embedded-agent reply: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * 通过 subagent 执行。
 */
async function dispatchViaSubagent(
  rt: any,
  params: {
    sessionKey: string;
    agentId: string;
    prompt: string;
    replyTopic: string;
    replyTag?: string;
    config: RockermqConfig;
  },
): Promise<void> {
  const childSessionKey = `agent:${params.agentId}:subagent:rocketmq:${sanitizeSessionId(params.sessionKey)}`;
  const { runId } = await rt.subagent.run({
    sessionKey: childSessionKey,
    message: params.prompt,
    deliver: false,
  });
  if (!params.config.dispatch.reply.enabled) {
    return;
  }
  const result = await rt.subagent.waitForRun({
    runId,
    timeoutMs: params.config.dispatch.timeoutMs,
  });
  const text =
    typeof result?.text === "string"
      ? result.text
      : typeof result?.message === "string"
        ? result.message
        : JSON.stringify(result ?? {});
  if (!text.trim()) {
    return;
  }
  try {
    const { publishMessage } = await import("./rocketmq-server.js");
    await publishMessage({
      topic: params.replyTopic,
      tag: params.replyTag,
      payload: JSON.stringify({ text }),
      endpoints: params.config.endpoints,
      namespace: params.config.namespace,
      sessionCredentials: params.config.sessionCredentials,
    });
  } catch (err) {
    console.warn(
      `[openclaw-rocketmq] Failed to publish subagent reply: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
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

/**
 * 解析消息文本。
 */
function parseInboundText(
  rawPayload: string,
  mode: RockermqConfig["payload"]["mode"],
): { text: string; correlationId?: string; idempotencyKey?: string } {
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

    const parsed = JSON.parse(rawPayload) as Record<string, unknown>;
    const text = typeof parsed.text === "string" ? parsed.text : JSON.stringify(parsed ?? {});
    return {
      text,
      correlationId: typeof parsed.correlationId === "string" ? parsed.correlationId : undefined,
      idempotencyKey: typeof parsed.idempotencyKey === "string" ? parsed.idempotencyKey : undefined,
    };
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
    const parsed = JSON.parse(rawPayload) as Record<string, unknown>;
    if (typeof parsed.text === "string" && parsed.text.trim().length > 0) {
      return {
        text: parsed.text,
        correlationId: typeof parsed.correlationId === "string" ? parsed.correlationId : undefined,
        idempotencyKey:
          typeof parsed.idempotencyKey === "string" ? parsed.idempotencyKey : undefined,
      };
    }
    return {
      text: rawPayload,
      correlationId: typeof parsed.correlationId === "string" ? parsed.correlationId : undefined,
      idempotencyKey: typeof parsed.idempotencyKey === "string" ? parsed.idempotencyKey : undefined,
    };
  } catch {
    return { text: rawPayload };
  }
}

/**
 * 清理过期去重键。
 */
function pruneIdempotency(now: number, ttlMs: number, maxEntries: number): void {
  if (ttlMs <= 0) {
    seenIdempotencyKeys.clear();
    return;
  }
  for (const [key, expiry] of seenIdempotencyKeys.entries()) {
    if (expiry <= now) {
      seenIdempotencyKeys.delete(key);
    }
  }
  while (seenIdempotencyKeys.size > maxEntries) {
    const firstKey = seenIdempotencyKeys.keys().next().value as string | undefined;
    if (!firstKey) break;
    seenIdempotencyKeys.delete(firstKey);
  }
}

/**
 * 提取 embedded agent 返回文本。
 */
function extractFinalTextFromRunResult(result: any): string {
  const payloads = Array.isArray(result?.payloads) ? result.payloads : [];
  return payloads
    .filter((item: any) => item && typeof item.text === "string" && item.isReasoning !== true)
    .map((item: any) => item.text as string)
    .join("\n");
}

/**
 * 规范化 sessionId。
 */
function sanitizeSessionId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._:-]+/g, "_").slice(0, 128);
}

/**
 * 生成加密安全的 runId。
 */
function cryptoRandom(): string {
  return `${Date.now()}-${randomBytes(16).toString("hex")}`;
}
