/**
 * @fileoverview OpenClaw 跨渠道消息 Router 的注册、规则匹配和运维入口。
 *
 * 监听 inbound、outbound 和 reply_payload 事件，按规则生成稳定幂等键与 hop trace，再交给
 * `ReliableRouteDispatcher` 持久化投递。trace 限制和已拥有 identity 检查防止路由环路；
 * 状态、健康、DLQ、审计及重放端点均要求插件认证，并只返回脱敏摘要。
 */
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";

import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { definePluginEntry, type OpenClawPluginDefinition } from "openclaw/plugin-sdk/plugin-entry";

import { resolveRouterConfig, resolveRouterStateDir } from "./config.js";
import { DurableRouteStore } from "./durable-store.js";
import { matchRule } from "./matcher.js";
import { ReliableRouteDispatcher, stableDeliveryKey } from "./reliable-dispatcher.js";
import type {
  PublishInboundParams,
  RouteAction,
  RouteDirection,
  RouterConfig,
  RouterRule,
} from "./types.js";

export { matchRule } from "./matcher.js";
export { stableDeliveryKey } from "./reliable-dispatcher.js";
export type { RouteAction, RouterConfig, RouterRule } from "./types.js";

type ChannelSendFn = (params: PublishInboundParams, signal?: AbortSignal) => Promise<void>;

type RouteEvent = {
  channelId: string;
  direction: RouteDirection;
  content: string;
  topic?: string;
  accountId?: string;
  recipient?: string;
  sessionKey?: string;
  runId?: string;
  messageId?: string;
  eventId: string;
  metadata: Record<string, unknown>;
};

type RouterTrace = { version: 1; hops: string[] };

class ReplyPayloadIdentityTracker {
  private readonly nextByRun = new Map<string, number>();

  next(event: Record<string, unknown>, ctx: Record<string, unknown>): string {
    const runId = readString(event.runId) ?? readString(ctx.runId);
    if (!runId) return `reply-unidentified-${randomUUID()}`;
    const key = `${readString(event.sessionKey) ?? readString(ctx.sessionKey) ?? "unknown"}:${runId}`;
    const sequence = this.nextByRun.get(key) ?? 0;
    this.nextByRun.delete(key);
    this.nextByRun.set(key, sequence + 1);
    if (this.nextByRun.size > 10_000) this.nextByRun.delete(this.nextByRun.keys().next().value as string);
    return `reply:${key}:${sequence}`;
  }
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function resolveAccountId(ctx: Record<string, unknown>): string | undefined {
  return readString(ctx.accountId) ?? readString(ctx.agentAccountId);
}

function resolveTopic(event: Record<string, unknown>): string | undefined {
  return readString(event.topic) ?? readString(record(event.metadata).topic);
}

function resolveContent(event: Record<string, unknown>): string | undefined {
  return readString(event.content) ?? readString(event.text) ?? readString(record(event.message).content);
}

const DIRECT_BROKER_CHANNELS = new Set(["mqtt", "mqtt-ws", "web-mqtt", "rabbitmq", "redis-stream", "rocketmq"]);
const DIRECT_TARGET_PREFIX = "openclaw-direct-topic:v1:";

function encodeOutboundTarget(channel: string, target: string): string {
  return DIRECT_BROKER_CHANNELS.has(channel)
    ? `${DIRECT_TARGET_PREFIX}${encodeURIComponent(target)}`
    : target;
}

function resolveChannelSend(api: OpenClawPluginApi): ChannelSendFn {
  return async (params, signal) => {
    const target = readString(params.to) ?? readString(params.topic);
    if (!target) throw new Error(`router target ${params.channel} requires action.to or action.topic`);
    const idempotencyKey = readString(params.metadata?.idempotencyKey);
    if (!idempotencyKey) throw new Error("router delivery is missing idempotencyKey");
    const adapter = await api.runtime.channel.outbound.loadAdapter(params.channel);
    if (!adapter) throw new Error(`router target channel adapter is unavailable: ${params.channel}`);
    const context = {
      cfg: api.runtime.config.current() as never,
      to: encodeOutboundTarget(params.channel, target),
      text: params.content,
      accountId: params.accountId ?? null,
      deliveryQueueId: idempotencyKey,
      abortSignal: signal,
    };
    if (adapter.sendText) {
      await adapter.sendText(context);
      return;
    }
    if (adapter.sendFormattedText) {
      await adapter.sendFormattedText(context);
      return;
    }
    if (adapter.sendPayload) {
      await adapter.sendPayload({ ...context, payload: { text: params.content } });
      return;
    }
    throw new Error(`router target channel has no text outbound method: ${params.channel}`);
  };
}

function resolveEvent(eventValue: unknown, ctxValue: unknown, direction: RouteDirection): RouteEvent | null {
  const event = record(eventValue);
  const ctx = record(ctxValue);
  const content = resolveContent(event);
  if (!content) return null;
  const metadata = record(event.metadata);
  const messageId = readString(ctx.messageId) ?? readString(event.messageId) ?? readString(event.id);
  const runId = readString(ctx.runId) ?? readString(event.runId);
  const stableIdentity = messageId ?? runId;
  return {
    channelId: readString(ctx.channelId) ?? readString(event.channelId) ?? "unknown",
    direction,
    content,
    topic: resolveTopic(event),
    accountId: resolveAccountId(ctx),
    recipient: readString(event.to) ?? readString(event.from) ?? readString(ctx.conversationId) ?? readString(ctx.senderId),
    sessionKey: readString(ctx.sessionKey),
    runId,
    messageId,
    eventId: stableIdentity ?? `unidentified-${randomUUID()}`,
    metadata,
  };
}

function readTrace(metadata: Record<string, unknown>): RouterTrace {
  const router = record(metadata.router);
  const hops = Array.isArray(router.hops)
    ? router.hops.filter((item): item is string => typeof item === "string")
    : [];
  return { version: 1, hops };
}

export function tmpl(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? `{{${key}}}`);
}

function payloadForAction(
  event: RouteEvent,
  rule: RouterRule,
  action: RouteAction,
  actionIndex: number,
  config: RouterConfig,
): PublishInboundParams | null {
  const trace = readTrace(event.metadata);
  const hop = `${rule.id}:${actionIndex}:${action.type}:${action.target}`;
  if (trace.hops.length >= config.delivery.maxHops || trace.hops.includes(hop)) return null;
  const metadata = {
    ...event.metadata,
    sessionKey: event.sessionKey,
    sourceChannel: event.channelId,
    ruleId: rule.id,
    direction: event.direction,
    runId: event.runId,
    messageId: event.messageId,
    router: { version: 1, hops: [...trace.hops, hop] },
  };
  if (action.type === "forward") {
    const topic = tmpl(action.topic ?? `openclaw/router/${event.channelId}/${event.direction}`, {
      channel: event.channelId,
      direction: event.direction,
      account: event.accountId ?? "default",
    });
    return { channel: action.target, content: event.content, topic, to: topic, metadata: { ...metadata, topic } };
  }
  return {
    channel: action.target,
    content: event.content,
    ...(action.accountId ? { accountId: action.accountId } : {}),
    ...(action.to ?? event.recipient ? { to: action.to ?? event.recipient } : {}),
    metadata,
  };
}

async function routeEvent(
  dispatcher: ReliableRouteDispatcher,
  config: RouterConfig,
  event: RouteEvent,
  actionType: RouteAction["type"],
): Promise<void> {
  const deliveries: Array<Parameters<ReliableRouteDispatcher["enqueueBatch"]>[0][number]> = [];
  for (const rule of config.rules) {
    if (!matchRule(rule, event.channelId, event.direction, event.topic, event.accountId)) continue;
    for (const [actionIndex, action] of rule.actions.entries()) {
      if (action.type !== actionType) continue;
      const payload = payloadForAction(event, rule, action, actionIndex, config);
      if (!payload) continue;
      const dedupeKey = stableDeliveryKey({
        eventId: event.eventId,
        channelId: event.channelId,
        accountId: event.accountId,
        direction: event.direction,
        ruleId: rule.id,
        actionIndex,
        action,
      });
      payload.metadata = {
        ...payload.metadata,
        idempotencyKey: dedupeKey,
        router: {
          ...record(payload.metadata?.router),
          deliveryId: dedupeKey,
        },
      };
      deliveries.push({ dedupeKey, ruleId: rule.id, actionType: action.type, payload });
    }
  }
  if (deliveries.length > 0) await dispatcher.enqueueBatch(deliveries);
}

function writeJson(res: { writeHead: (status: number, headers?: Record<string, string>) => void; end: (body?: string) => void }, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function deadLetterSummary(task: Awaited<ReturnType<ReliableRouteDispatcher["deadLetters"]>>[number]): Record<string, unknown> {
  return {
    id: task.id,
    ruleId: task.ruleId,
    actionType: task.actionType,
    target: task.payload.channel,
    to: task.payload.to ?? task.payload.topic,
    contentBytes: Buffer.byteLength(task.payload.content, "utf8"),
    attempts: task.attempts,
    createdAt: task.createdAt,
    nextAttemptAt: task.nextAttemptAt,
    lastError: task.lastError?.slice(0, 500),
  };
}

const plugin: OpenClawPluginDefinition = definePluginEntry({
  id: "router",
  name: "Message Router",
  description: "Durable cross-channel routing with retry, DLQ, dedupe, audit, and loop protection",
  register(api: OpenClawPluginApi) {
    if (api.registrationMode !== "full") return;
    const config = resolveRouterConfig(api);
    if (!config.enabled) {
      api.logger.info("[router] disabled");
      return;
    }

    const store = new DurableRouteStore(resolveRouterStateDir(config), config);
    const dispatcher = new ReliableRouteDispatcher(api, config, store, resolveChannelSend(api));
    const replyIdentities = new ReplyPayloadIdentityTracker();
    api.registerService({
      id: "openclaw-router-delivery",
      start: async () => dispatcher.start(),
      stop: async () => dispatcher.stop(),
    });

    api.on("message_received", async (event, ctx) => {
      const route = resolveEvent(event, ctx, "inbound");
      if (route) await routeEvent(dispatcher, config, route, "forward");
    }, { priority: 50 });

    api.on("message_sent", async (event, ctx) => {
      if ((event as { success?: boolean }).success === false) return;
      const identity = readString((event as { runId?: unknown }).runId) ?? readString((event as { messageId?: unknown }).messageId);
      if (await dispatcher.ownsIdentity(identity)) return;
      const route = resolveEvent(event, ctx, "outbound");
      if (route) await routeEvent(dispatcher, config, route, "forward");
    }, { priority: 50 });

    api.on("reply_payload_sending", async (event, ctx) => {
      const replyEvent = {
        ...record(event),
        ...record(record(event).payload),
        channelId: readString(record(event).channel),
        runId: readString(record(event).runId),
        sessionKey: readString(record(event).sessionKey),
        messageId: replyIdentities.next(record(event), record(ctx)),
      };
      const route = resolveEvent(replyEvent, ctx, "outbound");
      if (route) await routeEvent(dispatcher, config, route, "reply-via");
    }, { priority: 50 });

    api.registerHttpRoute({
      path: "/router/status",
      auth: "plugin",
      match: "exact",
      handler: async (req, res) => {
        if ((req.method ?? "GET") !== "GET") {
          res.setHeader("Allow", "GET");
          writeJson(res, 405, { ok: false, error: "Method Not Allowed" });
          return;
        }
        writeJson(res, 200, { ok: true, data: await dispatcher.status() });
      },
    });

    api.registerHttpRoute({
      path: "/router/health",
      auth: "plugin",
      match: "exact",
      handler: async (req, res) => {
        if ((req.method ?? "GET") !== "GET") {
          res.setHeader("Allow", "GET");
          writeJson(res, 405, { ok: false, error: "Method Not Allowed" });
          return;
        }
        const status = await dispatcher.status();
        writeJson(res, status.healthy ? 200 : 503, { ok: status.healthy, data: status });
      },
    });

    api.registerHttpRoute({
      path: "/router/dlq",
      auth: "plugin",
      match: "exact",
      handler: async (req, res) => {
        if ((req.method ?? "GET") !== "GET") {
          res.setHeader("Allow", "GET");
          writeJson(res, 405, { ok: false, error: "Method Not Allowed" });
          return;
        }
        const url = new URL(req.url ?? "/router/dlq", "http://localhost");
        const limit = Math.min(1_000, Math.max(1, Number(url.searchParams.get("limit") ?? 100) || 100));
        writeJson(res, 200, { ok: true, data: (await dispatcher.deadLetters(limit)).map(deadLetterSummary) });
      },
    });

    api.registerHttpRoute({
      path: "/router/audit",
      auth: "plugin",
      match: "exact",
      handler: async (req, res) => {
        if ((req.method ?? "GET") !== "GET") {
          res.setHeader("Allow", "GET");
          writeJson(res, 405, { ok: false, error: "Method Not Allowed" });
          return;
        }
        const url = new URL(req.url ?? "/router/audit", "http://localhost");
        const limit = Math.min(1_000, Math.max(1, Number(url.searchParams.get("limit") ?? 100) || 100));
        writeJson(res, 200, { ok: true, data: await dispatcher.auditEntries(limit) });
      },
    });

    api.registerHttpRoute({
      path: "/router/dlq/replay",
      auth: "plugin",
      match: "exact",
      handler: async (req, res) => {
        if (req.method !== "POST") {
          res.setHeader("Allow", "POST");
          writeJson(res, 405, { ok: false, error: "Method Not Allowed" });
          return;
        }
        const url = new URL(req.url ?? "/router/dlq/replay", "http://localhost");
        const limit = Math.min(1_000, Math.max(1, Number(url.searchParams.get("limit") ?? 100) || 100));
        writeJson(res, 202, { ok: true, data: { replayed: await dispatcher.replayDeadLetters(limit) } });
      },
    });

    api.logger.info(`[router] registered ${config.rules.length} rule(s), durable delivery enabled`);
  },
});

export default plugin;
