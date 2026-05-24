/**
 * openclaw-router — 企业级消息路由引擎
 *
 * 基于 OpenClaw Plugin Hooks：
 * - message_received — 入站转发（IM→MQ）
 * - message_sent — 出站转发（Agent 回复→MQ）
 * - reply_dispatch — 跨渠道 reply-via
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

import { RouteDedupeCache, buildRouteDedupeKey } from "./dedupe.js";

// ============================================================================
// 类型
// ============================================================================

interface RouterRule {
  id: string;
  match: {
    channels?: string[];
    direction?: "inbound" | "outbound" | "both";
    topic?: string;
    accountId?: string;
  };
  actions: Array<
    | { type: "forward"; target: string; topic?: string }
    | { type: "reply-via"; target: string; accountId?: string; to?: string }
  >;
}

interface RouterConfig {
  enabled: boolean;
  rules: RouterRule[];
  audit?: { enabled: boolean; logToConsole: boolean };
}

const DEFAULTS: RouterConfig = {
  enabled: true,
  rules: [],
  audit: { enabled: false, logToConsole: false },
};

/** 全局幂等缓存（单 Gateway 进程内） */
const dedupeCache = new RouteDedupeCache();

function getConfig(api: OpenClawPluginApi): RouterConfig {
  const r = (api.pluginConfig ?? {}) as Partial<RouterConfig>;
  return {
    ...DEFAULTS,
    ...r,
    audit: {
      enabled: r.audit?.enabled ?? DEFAULTS.audit!.enabled,
      logToConsole: r.audit?.logToConsole ?? DEFAULTS.audit!.logToConsole,
    },
    rules: Array.isArray(r.rules) ? r.rules : [],
  };
}

/**
 * 规则是否匹配当前渠道 / 方向 / topic / account。
 */
export function matchRule(
  rule: RouterRule,
  channelId: string,
  direction: "inbound" | "outbound",
  topic?: string,
  accountId?: string,
): boolean {
  const m = rule.match;
  if (m.channels?.length && !m.channels.includes(channelId)) return false;
  if (m.direction && m.direction !== "both" && m.direction !== direction) return false;
  if (m.topic && topic !== m.topic) return false;
  if (m.accountId && accountId !== m.accountId) return false;
  return true;
}

/**
 * 模板变量展开。
 */
export function tmpl(t: string, v: Record<string, string>): string {
  return t.replace(/\{\{(\w+)\}\}/g, (_, k) => v[k] ?? `{{${k}}}`);
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveAccountId(ctx: Record<string, unknown>): string | undefined {
  return readString(ctx.accountId) ?? readString(ctx.agentAccountId);
}

function resolveTopic(event: Record<string, unknown>): string | undefined {
  const direct = readString(event.topic);
  if (direct) return direct;
  const metadata = event.metadata;
  if (metadata && typeof metadata === "object") {
    return readString((metadata as Record<string, unknown>).topic);
  }
  return undefined;
}

function resolveContent(event: Record<string, unknown>): string | undefined {
  const content = event.content;
  if (typeof content === "string" && content.trim().length > 0) {
    return content;
  }
  return undefined;
}

type PublishInboundFn = (params: {
  channel: string;
  content: string;
  topic?: string;
  accountId?: string;
  to?: string;
  metadata?: Record<string, unknown>;
}) => void | Promise<void>;

/**
 * 解析 publishInbound（兼容 api.publishInbound 与 runtime.channel.publishInbound）。
 */
function resolvePublishInbound(api: OpenClawPluginApi): PublishInboundFn | undefined {
  const direct = (api as OpenClawPluginApi & { publishInbound?: PublishInboundFn }).publishInbound;
  if (typeof direct === "function") {
    return direct;
  }
  const runtimePublish = (
    api.runtime as { channel?: { publishInbound?: PublishInboundFn } } | undefined
  )?.channel?.publishInbound;
  return typeof runtimePublish === "function" ? runtimePublish : undefined;
}

/**
 * 执行 forward 动作。
 */
function executeForward(
  api: OpenClawPluginApi,
  cfg: RouterConfig,
  params: {
    rule: RouterRule;
    channelId: string;
    direction: "inbound" | "outbound";
    content: string;
    topic?: string;
    accountId?: string;
    sessionKey?: string;
    runId?: string;
    messageId?: string;
  },
): void {
  const publish = resolvePublishInbound(api);
  if (!publish) {
    api.logger.warn("[router] publishInbound unavailable — skip forward");
    return;
  }

  for (const action of params.rule.actions) {
    if (action.type !== "forward") continue;

    const dedupeKey = buildRouteDedupeKey([
      params.runId,
      params.messageId,
      params.rule.id,
      params.direction,
      action.target,
      action.topic ?? "default",
    ]);
    if (dedupeCache.shouldSkip(dedupeKey)) {
      if (cfg.audit?.logToConsole) {
        api.logger.info(`[router] dedupe skip forward rule=${params.rule.id} direction=${params.direction}`);
      }
      continue;
    }

    const subj = tmpl(action.topic ?? `openclaw/router/${params.channelId}/${params.direction}`, {
      channel: params.channelId,
      direction: params.direction,
      account: params.accountId ?? "default",
    });

    void Promise.resolve(
      publish({
        channel: action.target,
        content: params.content,
        topic: subj,
        metadata: {
          sessionKey: params.sessionKey,
          sourceChannel: params.channelId,
          ruleId: params.rule.id,
          topic: subj,
          direction: params.direction,
          runId: params.runId,
          messageId: params.messageId,
        },
      }),
    )
      .then(() => {
        if (cfg.audit?.logToConsole) {
          api.logger.info(`[router] → ${action.target}/${subj} (${params.direction})`);
        }
      })
      .catch((err: unknown) => api.logger.error(`[router] Forward failed: ${String(err)}`));
  }
}

/**
 * 执行 reply-via 动作。
 */
function executeReplyVia(
  api: OpenClawPluginApi,
  cfg: RouterConfig,
  params: {
    rule: RouterRule;
    channelId: string;
    content: string;
    sessionKey?: string;
    runId?: string;
    messageId?: string;
  },
): void {
  const publish = resolvePublishInbound(api);
  if (!publish) {
    api.logger.warn("[router] publishInbound unavailable — skip reply-via");
    return;
  }

  for (const action of params.rule.actions) {
    if (action.type !== "reply-via") continue;

    const dedupeKey = buildRouteDedupeKey([
      params.runId,
      params.messageId,
      params.rule.id,
      "reply-via",
      action.target,
      action.accountId ?? "default",
      action.to ?? "",
    ]);
    if (dedupeCache.shouldSkip(dedupeKey)) {
      if (cfg.audit?.logToConsole) {
        api.logger.info(`[router] dedupe skip reply-via rule=${params.rule.id}`);
      }
      continue;
    }

    void Promise.resolve(
      publish({
        channel: action.target,
        content: params.content,
        accountId: action.accountId,
        to: action.to,
        metadata: {
          sessionKey: params.sessionKey,
          sourceChannel: params.channelId,
          ruleId: params.rule.id,
          runId: params.runId,
          messageId: params.messageId,
        },
      }),
    )
      .then(() => {
        if (cfg.audit?.logToConsole) {
          api.logger.info(`[router] ↪ ${action.target}/${action.accountId ?? "default"}`);
        }
      })
      .catch((err: unknown) => api.logger.error(`[router] Reply-via failed: ${String(err)}`));
  }
}

// ============================================================================
// 插件入口
// ============================================================================

export default definePluginEntry({
  id: "router",
  name: "Message Router",
  description: "企业级消息路由引擎 — 跨渠道 IM↔MQ 消息转发",
  register(api: OpenClawPluginApi) {
    const cfg = getConfig(api);
    if (!cfg.enabled) {
      api.logger.info("[router] Disabled");
      return;
    }

    api.logger.info(`[router] Initialized · ${cfg.rules.length} rule(s)`);

    api.on(
      "message_received",
      (event, ctx) => {
        const channelId = readString(ctx.channelId) ?? "unknown";
        const accountId = resolveAccountId(ctx as Record<string, unknown>);
        const topic = resolveTopic(event as Record<string, unknown>);
        const content = resolveContent(event as Record<string, unknown>);
        if (!content) return;

        if (cfg.audit?.logToConsole) {
          api.logger.info(`[router] message_received channel=${channelId} account=${accountId ?? "-"}`);
        }

        for (const rule of cfg.rules) {
          if (!matchRule(rule, channelId, "inbound", topic, accountId)) continue;
          executeForward(api, cfg, {
            rule,
            channelId,
            direction: "inbound",
            content,
            topic,
            accountId,
            sessionKey: readString(ctx.sessionKey),
            runId: readString(ctx.runId),
            messageId: readString(ctx.messageId),
          });
        }
      },
      { priority: 50 },
    );

    api.on(
      "message_sent",
      (event, ctx) => {
        if ((event as { success?: boolean }).success === false) return;

        const channelId = readString(ctx.channelId) ?? "unknown";
        const accountId = resolveAccountId(ctx as Record<string, unknown>);
        const topic = resolveTopic(event as Record<string, unknown>);
        const content = resolveContent(event as Record<string, unknown>);
        if (!content) return;

        if (cfg.audit?.logToConsole) {
          api.logger.info(`[router] message_sent channel=${channelId} account=${accountId ?? "-"}`);
        }

        for (const rule of cfg.rules) {
          if (!matchRule(rule, channelId, "outbound", topic, accountId)) continue;
          executeForward(api, cfg, {
            rule,
            channelId,
            direction: "outbound",
            content,
            topic,
            accountId,
            sessionKey: readString(ctx.sessionKey),
            runId: readString(ctx.runId),
            messageId: readString(ctx.messageId),
          });
        }
      },
      { priority: 50 },
    );

    api.on(
      "reply_dispatch",
      (event, ctx) => {
        const hookCtx = ctx as Record<string, unknown>;
        const channelId = readString(hookCtx.channelId) ?? "unknown";
        const accountId = resolveAccountId(hookCtx);
        const topic = resolveTopic(event as Record<string, unknown>);
        const content = resolveContent(event as Record<string, unknown>);
        if (!content) return;

        for (const rule of cfg.rules) {
          if (!matchRule(rule, channelId, "outbound", topic, accountId)) continue;
          const hasReplyVia = rule.actions.some((a) => a.type === "reply-via");
          if (!hasReplyVia) continue;

          executeReplyVia(api, cfg, {
            rule,
            channelId,
            content,
            sessionKey: readString(hookCtx.sessionKey),
            runId: readString(hookCtx.runId),
            messageId: readString(hookCtx.messageId),
          });
        }
      },
      { priority: 50 },
    );

    api.on("gateway_stop", () => {
      dedupeCache.clear();
      api.logger.info("[router] Cleared route dedupe cache on gateway_stop");
    });

    api.logger.info("[router] Registered — message_received / message_sent / reply_dispatch hooks");
  },
});
