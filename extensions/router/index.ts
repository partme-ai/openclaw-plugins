/**
 * openclaw-router — 企业级消息路由引擎
 *
 * 功能：
 * 1. 监听所有渠道的 agent_end 事件，按配置规则多路分发消息
 * 2. 监听 before_prompt_build 事件，自动注入知识库和记忆上下文
 * 3. 支持 IM→MQ 和 MQ→IM 双向转发
 * 4. 纯配置驱动，无需修改任何渠道插件
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

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
  knowledge?: { autoInject: boolean; maxResults: number; scoreThreshold: number };
  memory?: { autoInject: boolean; maxResults: number };
  audit?: { enabled: boolean; logToConsole: boolean };
}

const DEFAULTS: RouterConfig = {
  enabled: true,
  rules: [],
  knowledge: { autoInject: false, maxResults: 5, scoreThreshold: 0.3 },
  memory: { autoInject: false, maxResults: 5 },
  audit: { enabled: false, logToConsole: false },
};

function getConfig(api: OpenClawPluginApi): RouterConfig {
  const r = (api.pluginConfig ?? {}) as Partial<RouterConfig>;
  return {
    ...DEFAULTS,
    ...r,
    knowledge: { ...DEFAULTS.knowledge, ...r.knowledge },
    memory: { ...DEFAULTS.memory, ...r.memory },
    audit: { ...DEFAULTS.audit, ...r.audit },
    rules: Array.isArray(r.rules) ? r.rules : [],
  };
}

function matchRule(rule: RouterRule, channelId: string, direction: "inbound" | "outbound", topic?: string, accountId?: string): boolean {
  const m = rule.match;
  if (m.channels?.length && !m.channels.includes(channelId)) return false;
  if (m.direction && m.direction !== "both" && m.direction !== direction) return false;
  if (m.topic && topic !== m.topic) return false;
  if (m.accountId && accountId !== m.accountId) return false;
  return true;
}

function tmpl(t: string, v: Record<string, string>): string {
  return t.replace(/\{\{(\w+)\}\}/g, (_, k) => v[k] ?? `{{${k}}}`);
}

// ============================================================================
// 插件入口
// ============================================================================

const plugin = {
  id: "router",
  name: "Message Router",
  description: "企业级消息路由引擎 — 跨渠道消息转发、知识库/记忆自动注入",
  configSchema: { type: "object" as const, additionalProperties: true, properties: {} },

  register(api: OpenClawPluginApi) {
    const cfg = getConfig(api);
    if (!cfg.enabled) { api.logger.info("[router] Disabled"); return; }

    api.logger.info(`[router] Initialized · ${cfg.rules.length} rule(s)`);

    // ── agent_end: 消息多路分发 ──────────────────────────────
    api.on("agent_end", (event: unknown, ctx) => {
      const channelId = ctx.channelId ?? "unknown";
      const accountId = ctx.agentAccountId;
      const e = event as Record<string, unknown>;
      const msgs = (Array.isArray(e.messages) ? e.messages : []) as Array<Record<string, unknown>>;
      if (msgs.length === 0) return;

      const userMsg = [...msgs].reverse().find((m) => m.role === "user");
      const agentReply = [...msgs].reverse().find((m) => m.role === "assistant");
      const topic = e.topic as string | undefined;

      if (cfg.audit?.logToConsole) {
        api.logger.info(`[router] agent_end channel=${channelId} account=${accountId} topic=${topic ?? "-"}`);
      }

      for (const rule of cfg.rules) {
        // Inbound
        if (matchRule(rule, channelId, "inbound", topic, accountId)) {
          for (const a of rule.actions) {
            if (a.type === "forward" && userMsg) {
              const subj = tmpl(a.topic ?? `openclaw/router/${channelId}/inbound`, { channel: channelId, direction: "inbound", account: accountId ?? "default" });
              api.publishInbound?.({ channel: a.target, content: userMsg.content as string, metadata: { sessionKey: ctx.sessionKey, sourceChannel: channelId, direction: "inbound", ruleId: rule.id, topic: subj } })
                .then(() => api.logger.info(`[router] → ${a.target}/${subj}`))
                .catch((err) => api.logger.error(`[router] Forward inbound failed: ${String(err)}`));
            }
          }
        }
        // Outbound
        if (matchRule(rule, channelId, "outbound", topic, accountId)) {
          for (const a of rule.actions) {
            if (a.type === "forward" && agentReply) {
              const subj = tmpl(a.topic ?? `openclaw/router/${channelId}/outbound`, { channel: channelId, direction: "outbound", account: accountId ?? "default" });
              api.publishInbound?.({ channel: a.target, content: agentReply.content as string, metadata: { sessionKey: ctx.sessionKey, sourceChannel: channelId, direction: "outbound", ruleId: rule.id, topic: subj } })
                .then(() => api.logger.info(`[router] → ${a.target}/${subj}`))
                .catch((err) => api.logger.error(`[router] Forward outbound failed: ${String(err)}`));
            }
            if (a.type === "reply-via" && agentReply) {
              api.publishInbound?.({ channel: a.target, content: agentReply.content as string, accountId: a.accountId, to: a.to, metadata: { sessionKey: ctx.sessionKey, sourceChannel: channelId } })
                .then(() => api.logger.info(`[router] ↪ ${a.target}/${a.accountId ?? "default"}`))
                .catch((err) => api.logger.error(`[router] Reply-via failed: ${String(err)}`));
            }
          }
        }
      }
    });

    // ── before_prompt_build: 注入知识库 + 记忆 ─────────────────
    api.on("before_prompt_build", async (event: unknown, ctx) => {
      let ctx2 = "";
      const prompt = (event as Record<string, unknown>).prompt as string | undefined;

      if (cfg.knowledge?.autoInject && prompt) {
        try {
          const r = await api.callTool?.("knowledge_search", { query: prompt, limit: cfg.knowledge.maxResults });
          if (r?.results?.length) {
            ctx2 += "\n【知识库】\n" + (r.results as Array<{ content: string }>).map((i) => `- ${i.content}`).join("\n");
          }
        } catch { /* knowledge not available */ }
      }

      if (cfg.memory?.autoInject) {
        try {
          const r = await api.callTool?.("memory_search", { query: "", session_key: ctx.sessionKey, limit: cfg.memory.maxResults });
          if (r?.results?.length) {
            ctx2 += "\n【用户记忆】\n" + (r.results as Array<{ content: string }>).map((i) => `- ${i.content}`).join("\n");
          }
        } catch { /* memory not available */ }
      }

      if (ctx2.trim()) return { appendSystemContext: ctx2 };
    });

    api.logger.info("[router] Registered — agent_end + before_prompt_build hooks");
  },
};

export default plugin;
