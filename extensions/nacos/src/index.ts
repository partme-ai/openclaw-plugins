/**
 * @fileoverview OpenClaw Nacos 插件 — Config Center 同步 + Gateway Naming 注册 + 集群发现。
 *
 * @module nacos
 *
 * Follows https://docs.openclaw.ai/plugins/sdk-entrypoints (`definePluginEntry` from `plugin-entry`),
 * https://docs.openclaw.ai/plugins/sdk-runtime (`api.runtime.config` async load/write).
 */

import {
  definePluginEntry,
  emptyPluginConfigSchema,
  type OpenClawPluginApi,
  type OpenClawPluginServiceContext,
} from "openclaw/plugin-sdk/plugin-entry";
import { parseNacosPluginConfig } from "./config/config-parse.js";
import { NacosConfigSyncService } from "./runtime/nacos-config-sync.js";
import { GatewayNacosRegistry } from "./runtime/nacos-registry.js";
import { WebhookClusterService } from "./runtime/nacos-cluster.js";
import { resolveGatewayPort } from "./config/resolve-endpoint.js";
import type { ClusterPeer, OpenClawConfigSlice, PluginLog } from "./shared/types.js";

export {
  NacosConfigSyncService,
  backupOpenClawConfig,
  resolveConfigFileForBackup,
} from "./runtime/nacos-config-sync.js";
export { expandEnvPlaceholdersInValue } from "./config/env-expand.js";
export { buildInstanceMetadata, GatewayNacosRegistry } from "./runtime/nacos-registry.js";
export {
  resolveGatewayPort,
  resolveHooksInfo,
  resolveRegisterIp,
  DEFAULT_GATEWAY_PORT,
} from "./config/resolve-endpoint.js";
export { deepMerge } from "./config/merge-deep.js";
export { formatTimestampYyyyMMddHHmmss } from "./shared/format-timestamp.js";
export {
  buildNacosConfigClientOptions,
  expandDataIdTemplate,
  resolveProfile,
  resolveServerAddr,
} from "./runtime/nacos-connection.js";
export { parseNacosPluginConfig } from "./config/config-parse.js";
export {
  flattenSpringNacosPluginConfig,
  resolveConfigServerList,
  resolveNamingServerList,
} from "./config/spring-normalize.js";
export { WebhookClusterService } from "./runtime/nacos-cluster.js";
export { createNacosSdkLogger, DEFAULT_GROUP, DEFAULT_NAMESPACE, DEFAULT_SERVICE, isPlainObject, tryCloseNacosClient } from "./shared/shared.js";
export type { ClusterPeer, NacosPluginConfig, OpenClawConfigSlice, PluginLog } from "./shared/types.js";

/** Prefixes for Gateway config reload planning after Nacos merges write to disk (see plugin `reload` field). */
const NACOS_PLUGIN_RELOAD = {
  restartPrefixes: ["plugins", "gateway", "channels", "discovery", "canvasHost"],
  hotPrefixes: ["hooks", "cron", "models", "agents.list", "agents.defaults"],
} as const;

/** Module-level health state shared between services and HTTP route. */
const healthState = {
  configSyncRunning: false,
  namingRegistered: false,
  clusterDiscoveryRunning: false,
  lastSyncTime: 0,
  lastError: null as string | null,
};

/** Sanitize error messages before exposing in HTTP responses. */
function sanitizeError(err: unknown): string {
  const raw = String(err);
  return raw
    .replace(/\/[^\s]*\//g, "[path]/")
    .replace(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, "[ip]");
}

/** 将 OpenClaw PluginLogger 适配为本插件的 {@link PluginLog} 接口。 */
function toPluginLog(logger: OpenClawPluginServiceContext["logger"]): PluginLog {
  return {
    info: (msg: string) => logger.info(msg),
    warn: (msg: string) => logger.warn(msg),
    error: (msg: string) => logger.error(msg),
    debug: (msg: string) => logger.debug?.(msg),
  };
}

/** Module-level cluster service reference for HTTP routes. */
let activeClusterService: WebhookClusterService | null = null;

/**
 * 注册 Nacos Config Center 同步服务（pull / merge / backup / subscribe）。
 *
 * @param api - OpenClaw 插件 API
 */
function registerNacosConfigCenterService(api: OpenClawPluginApi): void {
  let sync: NacosConfigSyncService | null = null;

  api.registerService({
    id: "openclaw-nacos-config",
    start: async (ctx: OpenClawPluginServiceContext) => {
      const parsed = parseNacosPluginConfig(api.pluginConfig);
      if (parsed.kind !== "ok") {
        return;
      }
      if (!parsed.config.configCenter?.enabled) {
        ctx.logger.debug?.("[openclaw-nacos] configCenter disabled; skipping");
        return;
      }

      sync = new NacosConfigSyncService();
      try {
        await sync.start({
          pluginConfig: parsed.config,
          getCurrentConfig: () => api.runtime.config.current(),
          replaceConfig: (next) =>
            api.runtime.config.replaceConfigFile({
              nextConfig: next as Parameters<
                typeof api.runtime.config.replaceConfigFile
              >[0]["nextConfig"],
              afterWrite: { mode: "auto" },
            }) as unknown as Promise<void>,
          stateDir: ctx.stateDir,
          logger: toPluginLog(ctx.logger),
          env: process.env,
        });
        healthState.configSyncRunning = true;
        healthState.lastSyncTime = Date.now();
        healthState.lastError = null;
      } catch (err) {
        healthState.configSyncRunning = false;
        healthState.lastError = sanitizeError(err);
        ctx.logger.error(`[openclaw-nacos] config center failed: ${String(err)}`);
        sync = null;
      }
    },
    stop: async (ctx: OpenClawPluginServiceContext) => {
      if (sync) {
        await sync.stop(toPluginLog(ctx.logger));
        sync = null;
      }
      healthState.configSyncRunning = false;
    },
  });
}

/**
 * 注册 Gateway 实例到 Nacos Naming（含 Hooks 元数据）。
 *
 * @param api - OpenClaw 插件 API
 */
function registerNacosNamingService(api: OpenClawPluginApi): void {
  let registry: GatewayNacosRegistry | null = null;

  api.registerService({
    id: "openclaw-nacos-naming",
    start: async (ctx: OpenClawPluginServiceContext) => {
      const parsed = parseNacosPluginConfig(api.pluginConfig);
      if (parsed.kind === "disabled") {
        ctx.logger.info("[openclaw-nacos] disabled in config; skipping Nacos registration");
        return;
      }
      if (parsed.kind === "skip") {
        ctx.logger.warn(`[openclaw-nacos] skipping: ${parsed.reason}`);
        return;
      }
      if (parsed.kind === "error") {
        ctx.logger.error(`[openclaw-nacos] ${parsed.message}`);
        return;
      }
      if (parsed.config.naming?.enabled === false) {
        ctx.logger.info("[openclaw-nacos] naming.disabled; skipping Nacos naming registration");
        return;
      }

      registry = new GatewayNacosRegistry();
      try {
        await registry.register({
          pluginConfig: parsed.config,
          openClawConfig: ctx.config as OpenClawConfigSlice,
          logger: toPluginLog(ctx.logger),
        });
        healthState.namingRegistered = true;
        healthState.lastError = null;
      } catch (err) {
        healthState.namingRegistered = false;
        healthState.lastError = sanitizeError(err);
        ctx.logger.error(`[openclaw-nacos] Nacos registration failed: ${String(err)}`);
        registry = null;
      }
    },
    stop: async (ctx: OpenClawPluginServiceContext) => {
      if (registry) {
        await registry.stop(toPluginLog(ctx.logger));
        registry = null;
      }
      healthState.namingRegistered = false;
    },
  });
}

/**
 * 注册 Webhook 集群发现服务（订阅 naming 变更，维护 peer 列表）。
 *
 * @param api - OpenClaw 插件 API
 */
function registerNacosClusterService(api: OpenClawPluginApi): void {
  let cluster: WebhookClusterService | null = null;

  api.registerService({
    id: "openclaw-nacos-cluster",
    start: async (ctx: OpenClawPluginServiceContext) => {
      const parsed = parseNacosPluginConfig(api.pluginConfig);
      if (parsed.kind !== "ok") {
        return;
      }
      if (parsed.config.naming?.enabled === false) {
        ctx.logger.debug?.("[openclaw-nacos] naming disabled; skipping cluster discovery");
        return;
      }
      if (parsed.config.clusterDiscovery?.enabled === false) {
        ctx.logger.debug?.("[openclaw-nacos] clusterDiscovery disabled; skipping");
        return;
      }

      const port = resolveGatewayPort(ctx.config as OpenClawConfigSlice);

      cluster = new WebhookClusterService();
      try {
        await cluster.start({
          pluginConfig: parsed.config,
          selfPort: port,
          logger: toPluginLog(ctx.logger),
        });
        activeClusterService = cluster;
        healthState.clusterDiscoveryRunning = true;
        healthState.lastError = null;
      } catch (err) {
        healthState.clusterDiscoveryRunning = false;
        healthState.lastError = sanitizeError(err);
        ctx.logger.error(`[openclaw-nacos] cluster discovery failed: ${String(err)}`);
        cluster = null;
      }
    },
    stop: async (ctx: OpenClawPluginServiceContext) => {
      if (cluster) {
        await cluster.stop(toPluginLog(ctx.logger));
        cluster = null;
      }
      activeClusterService = null;
      healthState.clusterDiscoveryRunning = false;
    },
  });
}

export default definePluginEntry({
  id: "nacos",
  name: "Nacos gateway registration",
  description:
    "Nacos Config Center (merge, backup, subscribe) and Gateway/Hooks naming registration",
  configSchema: emptyPluginConfigSchema,
  reload: {
    restartPrefixes: [...NACOS_PLUGIN_RELOAD.restartPrefixes],
    hotPrefixes: [...NACOS_PLUGIN_RELOAD.hotPrefixes],
  },
  /**
   * 完整注册模式：Config Center、Naming、Cluster 三个 service + 诊断 HTTP 路由。
   *
   * @param api - OpenClaw 插件 API；`registrationMode !== "full"` 时 no-op
   */
  register(api: OpenClawPluginApi) {
    /** Long-lived clients only in full registration; see sdk-entrypoints "Registration mode". */
    if (api.registrationMode !== "full") {
      return;
    }

    registerNacosConfigCenterService(api);
    registerNacosNamingService(api);
    registerNacosClusterService(api);

    // Health check HTTP endpoint — internal diagnostics
    api.registerHttpRoute({
      path: "/nacos/health",
      auth: "plugin",
      match: "exact",
      handler: async (_req, res) => {
        const body = JSON.stringify({
          status: healthState.lastError ? "degraded" : "ok",
          configSync: { running: healthState.configSyncRunning },
          naming: { registered: healthState.namingRegistered },
          clusterDiscovery: { running: healthState.clusterDiscoveryRunning },
          lastSyncTime: healthState.lastSyncTime
            ? new Date(healthState.lastSyncTime).toISOString()
            : null,
          lastError: healthState.lastError,
        });
        (res as { writeHead: (s: number, h: Record<string, string>) => void; end: (d: string) => void }).writeHead(200, { "Content-Type": "application/json" });
        (res as { end: (d: string) => void }).end(body);
      },
    });

    // Cluster discovery HTTP endpoint — internal diagnostics
    api.registerHttpRoute({
      path: "/nacos/cluster",
      auth: "plugin",
      match: "exact",
      handler: async (_req, res) => {
        const clusterSvc = activeClusterService;
        const state = clusterSvc?.getState();
        const body = JSON.stringify({
          peers: state?.peers ?? [],
          peerCount: state?.peers.length ?? 0,
          lastUpdated: state?.lastUpdated
            ? new Date(state.lastUpdated).toISOString()
            : null,
          discoveryRunning: healthState.clusterDiscoveryRunning,
        });
        (res as { writeHead: (s: number, h: Record<string, string>) => void; end: (d: string) => void }).writeHead(200, { "Content-Type": "application/json" });
        (res as { end: (d: string) => void }).end(body);
      },
    });
  },
});
