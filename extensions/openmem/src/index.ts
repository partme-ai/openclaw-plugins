/**
 * @fileoverview OpenMem 外部化记忆插件的 OpenClaw 注册入口。
 *
 * 插件把 Sidecar 搜索适配为 Memory Host 和 `openmem_search` 工具，并按 session_start、
 * agent_end、session_end 生命周期创建会话、摄取成功对话和提交归档。所有能力限定到配置的
 * Agent；`required=false` 时 Sidecar 启动不可用只降级告警，不阻断 Gateway。
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import {
  buildJsonPluginConfigSchema,
  definePluginEntry,
  type OpenClawPluginDefinition,
  type OpenClawPluginToolContext,
} from "openclaw/plugin-sdk/plugin-entry";

import { OpenMemClient } from "./client.js";
import { resolveConfig } from "./config.js";
import { normalizeTurn, OpenMemCoordinator } from "./coordinator.js";
import { OpenMemSearchManager } from "./manager.js";
import { redactOpenMemError } from "./redact.js";

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    enabled: { type: "boolean" as const, default: true },
    required: { type: "boolean" as const, default: false },
    baseUrl: { type: "string" as const, default: "http://127.0.0.1:3317" },
    agentId: { type: "string" as const, minLength: 1, maxLength: 128, default: "main" },
    maxSearchResults: { type: "integer" as const, minimum: 1, maximum: 100, default: 10 },
    timeoutMs: { type: "integer" as const, minimum: 100, maximum: 120000, default: 5000 },
    maxAttempts: { type: "integer" as const, minimum: 1, maximum: 5, default: 3 },
    retryBaseDelayMs: { type: "integer" as const, minimum: 0, maximum: 5000, default: 100 },
    maxRequestBytes: { type: "integer" as const, minimum: 1024, maximum: 8388608, default: 2097152 },
    maxResponseBytes: { type: "integer" as const, minimum: 1024, maximum: 16777216, default: 2097152 },
    maxCacheBytes: { type: "integer" as const, minimum: 1048576, maximum: 67108864, default: 8388608 },
    allowSharedRecall: { type: "boolean" as const, default: false },
    apiKeyEnv: { type: "string" as const, pattern: "^[A-Za-z_][A-Za-z0-9_]*$" },
    authHeader: { type: "string" as const, pattern: "^[!#$%&'*+.^_`|~0-9A-Za-z-]+$", default: "Authorization" },
    authScheme: { type: "string" as const, maxLength: 64, default: "Bearer" },
  },
};

function createSearchTool(manager: OpenMemSearchManager, context: OpenClawPluginToolContext, limit: number) {
  return {
    name: "openmem_search",
    label: "OpenMem Search",
    description: "通过 OpenMem 搜索当前 Agent 的外部化记忆。",
    parameters: {
      type: "object" as const,
      additionalProperties: false,
      properties: {
        query: { type: "string" as const, minLength: 1, maxLength: 4000 },
        limit: { type: "number" as const, minimum: 1, maximum: limit },
      },
      required: ["query"],
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const query = typeof params.query === "string" ? params.query.trim() : "";
      if (!query) throw new Error("query must not be empty");
      if (query.length > 4_000) throw new Error("query must not exceed 4000 characters");
      const requested = typeof params.limit === "number" ? Math.floor(params.limit) : limit;
      const results = await manager.search(query, {
        maxResults: Math.min(Math.max(requested, 1), limit),
        ...(context.sessionKey ? { sessionKey: context.sessionKey } : {}),
      });
      return {
        content: [{
          type: "text" as const,
          text: results.length === 0
            ? "未找到 OpenMem 记忆。"
            : results.map((result, index) => `${index + 1}. ${result.snippet} (${result.citation})`).join("\n"),
        }],
        details: { count: results.length, agentId: context.agentId, sessionScoped: Boolean(context.sessionKey) },
      };
    },
  };
}

const plugin: OpenClawPluginDefinition = definePluginEntry({
  id: "openmem",
  name: "OpenMem",
  kind: "memory",
  description: "OpenMem REST bridge with scoped session lifecycle, reliable HTTP, and externalized-memory recall",
  configSchema: buildJsonPluginConfigSchema(configSchema, { cacheKey: "openclaw-openmem" }),
  register(api: OpenClawPluginApi) {
    if (api.registrationMode !== "full") return;
    const config = resolveConfig(api);
    if (!config.enabled) {
      api.logger.info("[openmem] disabled");
      return;
    }
    const client = new OpenMemClient(config);
    const coordinator = new OpenMemCoordinator(client, config.agentId);
    const manager = new OpenMemSearchManager(client, coordinator, config);

    api.registerService({
      id: "openclaw-openmem-client",
      start: async ({ logger }) => {
        try {
          await manager.sync();
          logger.info(`[openmem] connected to ${config.baseUrl}`);
        } catch (error) {
          if (config.required) throw error;
          logger.warn(`[openmem] sidecar unavailable at startup: ${redactOpenMemError(error)}`);
        }
      },
      stop: async () => {
        // 先广播取消，再等待 session 串行链释放，避免 stop 返回后仍残留退避定时器或 Hook。
        client.close();
        await coordinator.drain();
        await manager.close();
      },
    });

    api.registerMemoryCapability({
      runtime: {
        async getMemorySearchManager({ agentId }) {
          if (agentId !== config.agentId) return { manager: null, error: `OpenMem is scoped to agent ${config.agentId}` };
          return { manager };
        },
        resolveMemoryBackendConfig() { return { backend: "builtin" }; },
        async closeMemorySearchManager() { await manager.close(); },
        async closeAllMemorySearchManagers() { await manager.close(); },
      },
    });

    api.registerTool((context) => {
      if ((context.agentId?.trim() || "main") !== config.agentId) return null;
      return createSearchTool(manager, context, config.maxSearchResults);
    }, { name: "openmem_search" });

    api.on("session_start", async (event, context) => {
      if ((context.agentId?.trim() || "main") !== config.agentId) return;
      const sessionKey = event.sessionKey ?? context.sessionKey ?? event.sessionId;
      try { await coordinator.startSession(sessionKey); }
      catch (error) { api.logger.warn(`[openmem] session start failed: ${redactOpenMemError(error)}`); }
    });

    api.on("agent_end", async (event, context) => {
      if (!event.success || (context.agentId?.trim() || "main") !== config.agentId) return;
      const messages = normalizeTurn(event.messages);
      if (messages.length === 0) return;
      const sessionKey = context.sessionKey ?? context.sessionId;
      if (!sessionKey?.trim()) {
        api.logger.warn("[openmem] ingest skipped: trusted session key is unavailable");
        return;
      }
      try {
        await coordinator.ingestTurn({
          sessionKey,
          messages,
          ...(event.runId ? { runId: event.runId } : {}),
          ...(context.channel ? { channel: context.channel } : {}),
        });
      } catch (error) {
        api.logger.warn(`[openmem] ingest failed: ${redactOpenMemError(error)}`);
      }
    });

    api.on("session_end", async (event, context) => {
      if ((context.agentId?.trim() || "main") !== config.agentId) return;
      const sessionKey = event.sessionKey ?? context.sessionKey ?? event.sessionId;
      try { await coordinator.endSession(sessionKey); }
      catch (error) { api.logger.warn(`[openmem] session commit failed: ${redactOpenMemError(error)}`); }
    });

    api.logger.info(
      `[openmem] registered (agent=${config.agentId}, sharedRecall=${config.allowSharedRecall}, endpoint=${config.baseUrl})`,
    );
  },
});

export { OpenMemClient, OpenMemHttpError } from "./client.js";
export { resolveConfig } from "./config.js";
export { normalizeTurn, OpenMemCoordinator } from "./coordinator.js";
export { OpenMemSearchManager } from "./manager.js";
export type * from "./config.js";

/** 为兼容调用方创建允许共享检索的独立 OpenMem Search Manager。 */
export function createOpenMemSearchManager(baseUrl: string): OpenMemSearchManager {
  const config = resolveConfig({ pluginConfig: { baseUrl, allowSharedRecall: true } } as never);
  const client = new OpenMemClient(config);
  return new OpenMemSearchManager(client, new OpenMemCoordinator(client, config.agentId), config);
}

export default plugin;
