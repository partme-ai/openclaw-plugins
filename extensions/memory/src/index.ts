import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import {
  buildJsonPluginConfigSchema,
  definePluginEntry,
  type OpenClawPluginDefinition,
  type OpenClawPluginToolContext,
} from "openclaw/plugin-sdk/plugin-entry";

import { resolveConfig } from "./config.js";
import {
  buildMemoryRecords,
  generateId,
  normalizeTurnMessages,
  sessionCounters,
  shouldExtract,
} from "./extraction.js";
import { MemoryStore } from "./store.js";
import { extractKeywords, keywordScore } from "./text.js";

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    enabled: { type: "boolean" as const, default: true },
    dataDir: { type: "string" as const, default: "~/.openclaw/state/memory" },
    maxSearchResults: { type: "integer" as const, minimum: 1, maximum: 100, default: 10 },
    retentionDays: { type: "integer" as const, minimum: 1, maximum: 3650, default: 90 },
    extractionInterval: { type: "integer" as const, minimum: 1, maximum: 100, default: 5 },
    maxRecordBytes: { type: "integer" as const, minimum: 1024, maximum: 1048576, default: 65536 },
    profileScope: { type: "string" as const, enum: ["session", "agent"], default: "session" },
    encryptionKeyEnv: { type: "string" as const },
  },
};

function createMemoryTool(store: MemoryStore, context: OpenClawPluginToolContext, maxResults: number) {
  const agentId = context.agentId?.trim() || "main";
  const manager = store.createSearchManager(agentId);
  return {
    name: "memory_search",
    label: "Memory Search",
    description: "搜索当前 Agent 的长期记忆；默认按会话隔离。",
    parameters: {
      type: "object" as const,
      additionalProperties: false,
      properties: {
        query: { type: "string" as const, minLength: 1, description: "搜索查询" },
        limit: { type: "number" as const, minimum: 1, maximum: 100, description: "返回上限" },
      },
      required: ["query"],
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const query = typeof params.query === "string" ? params.query.trim() : "";
      if (!query) throw new Error("query must not be empty");
      const requested = typeof params.limit === "number" ? params.limit : maxResults;
      const results = await manager.search(query, {
        maxResults: Math.min(Math.max(Math.floor(requested), 1), maxResults),
        ...(context.sessionKey ? { sessionKey: context.sessionKey } : {}),
      });
      return {
        content: [{
          type: "text" as const,
          text: results.length === 0
            ? "未找到相关记忆。"
            : results.map((result, index) => `${index + 1}. ${result.snippet} (${result.citation})`).join("\n"),
        }],
        details: { count: results.length, agentId, sessionScoped: Boolean(context.sessionKey) },
      };
    },
  };
}

const plugin: OpenClawPluginDefinition = definePluginEntry({
  id: "memory",
  name: "Memory",
  kind: "memory",
  description: "本地分层长期记忆：L0 对话、L1 情景、L2 场景、L3 画像，支持隔离、保留和可选加密",
  configSchema: buildJsonPluginConfigSchema(configSchema, { cacheKey: "openclaw-memory" }),
  register(api: OpenClawPluginApi) {
    if (api.registrationMode !== "full") return;
    const config = resolveConfig(api);
    if (!config.enabled) {
      api.logger.info("[memory] disabled");
      return;
    }
    const conversationAccessAllowed =
      api.config?.plugins?.entries?.memory?.hooks?.allowConversationAccess === true;
    if (!conversationAccessAllowed) {
      api.logger.warn(
        "[memory] conversation capture requires plugins.entries.memory.hooks.allowConversationAccess=true; the Memory Host can load, but agent_end persistence will be blocked until this trust policy is enabled",
      );
    }

    const store = new MemoryStore(config);
    const managers = new Map<string, ReturnType<MemoryStore["createSearchManager"]>>();
    let cleanupTimer: NodeJS.Timeout | undefined;
    const managerFor = (agentId: string) => {
      const key = agentId.trim() || "main";
      const existing = managers.get(key);
      if (existing) return existing;
      const manager = store.createSearchManager(key);
      managers.set(key, manager);
      return manager;
    };

    api.registerService({
      id: "openclaw-memory-store",
      start: async ({ logger }) => {
        await store.initialize();
        const removed = await store.cleanup();
        if (removed > 0) logger.info(`[memory] retention cleanup removed ${removed} expired file(s)`);
        cleanupTimer = setInterval(() => {
          store.cleanup().then((count) => {
            if (count > 0) logger.info(`[memory] retention cleanup removed ${count} expired file(s)`);
          }).catch((error: unknown) => logger.warn(`[memory] retention cleanup failed: ${String(error)}`));
        }, 24 * 60 * 60 * 1000);
        cleanupTimer.unref();
      },
      stop: async () => {
        if (cleanupTimer) clearInterval(cleanupTimer);
        cleanupTimer = undefined;
        await store.close();
        managers.clear();
        sessionCounters.clear();
      },
    });

    api.registerMemoryCapability({
      runtime: {
        async getMemorySearchManager({ agentId }) {
          return { manager: managerFor(agentId) };
        },
        resolveMemoryBackendConfig() {
          return { backend: "builtin" };
        },
        async closeMemorySearchManager({ agentId }) {
          const manager = managers.get(agentId);
          await manager?.close?.();
          managers.delete(agentId);
        },
        async closeAllMemorySearchManagers() {
          await Promise.all([...managers.values()].map((manager) => manager.close?.()));
          managers.clear();
        },
      },
    });

    api.registerTool(
      (context) => createMemoryTool(store, context, config.maxSearchResults),
      { name: "memory_search" },
    );

    api.on("agent_end", async (event, context) => {
      if (!event.success) return;
      const messages = normalizeTurnMessages(event.messages);
      if (messages.length === 0) return;
      const agentId = context.agentId?.trim() || "main";
      const sessionKey = context.sessionKey?.trim() || context.sessionId?.trim() || "unknown";
      const runId = event.runId?.trim();
      try {
        const appended = await store.appendTurn({
          id: generateId(),
          level: "L0",
          type: "conversation",
          agentId,
          sessionKey,
          ...(context.senderId ? { senderId: context.senderId } : {}),
          ...(runId ? { runId } : {}),
          messages,
          createdAt: new Date().toISOString(),
        });
        if (!appended) return;
        const counterKey = `${agentId}\u0000${sessionKey}`;
        await store.appendRecords(buildMemoryRecords({
          agentId,
          sessionKey,
          ...(context.senderId ? { senderId: context.senderId } : {}),
          ...(runId ? { runId } : {}),
          messages,
          createScenario: shouldExtract(counterKey, config.extractionInterval),
        }));
      } catch (error) {
        api.logger.warn(`[memory] failed to persist completed turn: ${String(error)}`);
      }
    });

    api.logger.info(
      `[memory] registered (retention=${config.retentionDays}d, encrypted=${Boolean(config.encryptionKeyEnv)}, profileScope=${config.profileScope})`,
    );
  },
});

export { resolveConfig } from "./config.js";
export { buildMemoryRecords, generateId, normalizeTurnMessages, sessionCounters, shouldExtract } from "./extraction.js";
export { MemoryStore } from "./store.js";
export { extractKeywords, keywordScore } from "./text.js";
export type * from "./model.js";

export default plugin;
