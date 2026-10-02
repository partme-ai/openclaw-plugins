/**
 * @fileoverview OpenMem 外部化记忆插件的 OpenClaw 注册入口。
 *
 * 插件把 Sidecar 搜索适配为 Memory Host 和 `openmem_search` 工具，并按 session_start、
 * agent_end、session_end 生命周期创建会话、摄取成功对话和提交归档。所有能力限定到配置的
 * Agent；`required=false` 时 Sidecar 启动不可用只降级告警，不阻断 Gateway。
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
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

type AgentEndHandler = (
  event: { success: boolean; messages: unknown[]; runId?: string },
  context: { agentId?: string; sessionKey?: string; sessionId?: string; channel?: string },
) => Promise<void>;

type OpenMemRuntime = {
  agentEnd: AgentEndHandler;
  manager: OpenMemSearchManager;
  coordinator: OpenMemCoordinator;
  commitSession: (sessionKey: string) => Promise<void>;
  owners: Set<symbol>;
  fullOwners: Set<symbol>;
  discoveryOwners: Set<symbol>;
  start: (logger: { info: (message: string) => void; warn: (message: string) => void }) => Promise<void>;
  release: (owner: symbol) => Promise<void>;
  isActive: () => boolean;
};

// Agent discovery and Gateway full registration must share one coordinator. Otherwise
// session_end can commit while an independent agent_end coordinator still ingests.
const runtimeSymbol = Symbol.for("@partme.ai/openclaw-openmem/gateway-runtimes/v3");
const globalRuntimes = globalThis as unknown as Record<symbol, Map<string, OpenMemRuntime>>;
const gatewayRuntimes = globalRuntimes[runtimeSymbol] ??= new Map<string, OpenMemRuntime>();

function runtimeKey(api: OpenClawPluginApi, config: ReturnType<typeof resolveConfig>): string {
  return JSON.stringify([api.source ?? "", config]);
}

function createGatewayRuntime(
  api: OpenClawPluginApi,
  config: ReturnType<typeof resolveConfig>,
  key: string,
): OpenMemRuntime {
  const client = new OpenMemClient(config);
  const coordinator = new OpenMemCoordinator(client, config.agentId);
  const manager = new OpenMemSearchManager(client, coordinator, config);
  const owners = new Set<symbol>();
  const fullOwners = new Set<symbol>();
  const discoveryOwners = new Set<symbol>();
  const activeAgentEnds = new Set<Promise<void>>();
  const pendingCommits = new Map<string, symbol>();
  let stopping = false;
  let startPromise: Promise<void> | undefined;
  let shutdownPromise: Promise<void> | undefined;
  const commitSession = async (sessionKey: string): Promise<void> => {
    const ticket = Symbol("openmem-session-commit");
    pendingCommits.set(sessionKey, ticket);
    await coordinator.endSession(sessionKey);
    if (pendingCommits.get(sessionKey) === ticket) pendingCommits.delete(sessionKey);
  };
  const handleAgentEnd: AgentEndHandler = async (event, context) => {
    if (stopping || !event.success || (context.agentId?.trim() || "main") !== config.agentId) return;
    const messages = normalizeTurn(event.messages);
    if (messages.length === 0) return;
    const sessionKey = context.sessionKey ?? context.sessionId;
    if (!sessionKey?.trim()) {
      api.logger.warn("[openmem] ingest skipped: trusted session key is unavailable");
      return;
    }
    const mustCommitAfterIngest = fullOwners.size === 0;
    try {
      await coordinator.ingestTurn({
        sessionKey,
        messages,
        ...(event.runId ? { runId: event.runId } : {}),
        ...(context.channel ? { channel: context.channel } : {}),
      });
      // 轮次开始时若无 full owner，后续注册的新 generation 不会补发旧轮次的 session_end。
      if (mustCommitAfterIngest || fullOwners.size === 0) {
        try {
          await commitSession(sessionKey);
        } catch (error) {
          api.logger.warn(`[openmem] session commit pending: ${redactOpenMemError(error)}`);
        }
      }
    } catch (error) {
      api.logger.warn(`[openmem] ingest failed: ${redactOpenMemError(error)}`);
    }
  };
  const agentEnd: AgentEndHandler = (event, context) => {
    const operation = handleAgentEnd(event, context);
    activeAgentEnds.add(operation);
    void operation.then(
      () => { activeAgentEnds.delete(operation); },
      () => { activeAgentEnds.delete(operation); },
    );
    return operation;
  };
  const runtime: OpenMemRuntime = {
    agentEnd,
    manager,
    coordinator,
    commitSession,
    owners,
    fullOwners,
    discoveryOwners,
    isActive: () => !stopping,
    start(logger) {
      if (stopping) return Promise.resolve();
      if (!startPromise) {
        startPromise = manager.sync().then(() => {
          if (!stopping) logger.info(`[openmem] connected to ${config.baseUrl}`);
        }).catch((error: unknown) => {
          if (config.required) throw error;
          if (!stopping) logger.warn(`[openmem] sidecar unavailable at startup: ${redactOpenMemError(error)}`);
        }).catch((error: unknown) => {
          startPromise = undefined;
          throw error;
        });
      }
      return startPromise;
    },
    release(owner) {
      if (!owners.delete(owner)) return shutdownPromise ?? Promise.resolve();
      const gracefulDiscoveryRelease = discoveryOwners.delete(owner);
      fullOwners.delete(owner);
      if (owners.size > 0) return Promise.resolve();
      stopping = true;
      if (gatewayRuntimes.get(key) === runtime) gatewayRuntimes.delete(key);
      shutdownPromise ??= (async () => {
        if (!gracefulDiscoveryRelease && pendingCommits.size === 0) client.close();
        try {
          await startPromise?.catch(() => undefined);
          if (gracefulDiscoveryRelease) await Promise.allSettled([...activeAgentEnds]);
          await coordinator.drain();
          // 退出前收敛待提交轮次；结果不明的 POST 只核对状态，绝不盲目重放。
          for (const sessionKey of pendingCommits.keys()) {
            try {
              await coordinator.endSession(sessionKey);
              pendingCommits.delete(sessionKey);
            } catch (error) {
              api.logger.warn(`[openmem] session commit remains pending: ${redactOpenMemError(error)}`);
            }
          }
          await manager.close();
        } finally {
          client.close();
        }
      })();
      return shutdownPromise;
    },
  };
  return runtime;
}

function registerAgentRuntime(api: OpenClawPluginApi, config: ReturnType<typeof resolveConfig>, runtime: OpenMemRuntime): void {
  api.registerTool((context) => {
    if (!runtime.isActive() || (context.agentId?.trim() || "main") !== config.agentId) return null;
    return createSearchTool(runtime.manager, context, config.maxSearchResults);
  }, { name: "openmem_search" });
  api.on("agent_end", runtime.agentEnd);
}

const plugin: OpenClawPluginDefinition = definePluginEntry({
  id: "openmem",
  name: "OpenMem",
  kind: "memory",
  description: "OpenMem REST bridge with scoped session lifecycle, reliable HTTP, and externalized-memory recall",
  configSchema: buildJsonPluginConfigSchema(configSchema, { cacheKey: "openclaw-openmem" }),
  register(api: OpenClawPluginApi) {
    const config = resolveConfig(api);
    if (!config.enabled) {
      api.logger.info("[openmem] disabled");
      return;
    }
    const key = runtimeKey(api, config);
    if (api.registrationMode !== "full") {
      const runtime = gatewayRuntimes.get(key);
      if (!runtime) {
        api.logger.warn("[openmem] Gateway-owned runtime unavailable during Agent discovery");
        return;
      }
      if (!api.lifecycle?.onDispose) {
        registerAgentRuntime(api, config, runtime);
        return;
      }
      const owner = Symbol("openmem-agent-generation");
      runtime.owners.add(owner);
      runtime.discoveryOwners.add(owner);
      const release = () => runtime.release(owner);
      try {
        api.lifecycle.onDispose(release);
        registerAgentRuntime(api, config, runtime);
      } catch (error) {
        void release().catch((releaseError: unknown) => {
          api.logger.warn(`[openmem] failed to clean up Agent discovery: ${redactOpenMemError(releaseError)}`);
        });
        throw error;
      }
      return;
    }
    const runtime = gatewayRuntimes.get(key) ?? createGatewayRuntime(api, config, key);
    gatewayRuntimes.set(key, runtime);
    const owner = Symbol("openmem-gateway-registration");
    runtime.owners.add(owner);
    runtime.fullOwners.add(owner);
    const release = () => runtime.release(owner);
    const { coordinator, manager } = runtime;
    try {
      api.lifecycle?.onDispose?.(release);
      api.registerService({
        id: "openclaw-openmem-client",
        start: ({ logger }) => runtime.start(logger),
        stop: release,
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

      registerAgentRuntime(api, config, runtime);

      api.on("session_start", async (event, context) => {
        if (!runtime.isActive()) return;
        if ((context.agentId?.trim() || "main") !== config.agentId) return;
        const sessionKey = event.sessionKey ?? context.sessionKey ?? event.sessionId;
        try { await coordinator.startSession(sessionKey); }
        catch (error) { api.logger.warn(`[openmem] session start failed: ${redactOpenMemError(error)}`); }
      });

      api.on("session_end", async (event, context) => {
        if (!runtime.isActive()) return;
        if ((context.agentId?.trim() || "main") !== config.agentId) return;
        const sessionKey = event.sessionKey ?? context.sessionKey ?? event.sessionId;
        try { await runtime.commitSession(sessionKey); }
        catch (error) { api.logger.warn(`[openmem] session commit failed: ${redactOpenMemError(error)}`); }
      });

      api.logger.info(
        `[openmem] registered (agent=${config.agentId}, sharedRecall=${config.allowSharedRecall}, endpoint=${config.baseUrl})`,
      );
    } catch (error) {
      void release().catch((releaseError: unknown) => {
        api.logger.warn(`[openmem] failed to clean up rejected registration: ${redactOpenMemError(releaseError)}`);
      });
      throw error;
    }
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
