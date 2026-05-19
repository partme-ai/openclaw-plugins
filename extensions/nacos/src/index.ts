/**
 * OpenClaw plugin: Nacos Config Center (merge + backup + subscribe) and Nacos naming registration for Gateway/Hooks.
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
import { parseNacosPluginConfig } from "./config-parse.js";
import { NacosConfigSyncService } from "./nacos-config-sync.js";
import { GatewayNacosRegistry } from "./nacos-registry.js";
import { WebhookClusterService } from "./nacos-cluster.js";
import { resolveGatewayPort } from "./resolve-endpoint.js";
import type { ClusterPeer, OpenClawConfigSlice } from "./types.js";

export {
  NacosConfigSyncService,
  backupOpenClawConfig,
  resolveConfigFileForBackup,
} from "./nacos-config-sync.js";
export { expandEnvPlaceholdersInValue } from "./env-expand.js";
export { buildInstanceMetadata, GatewayNacosRegistry } from "./nacos-registry.js";
export {
  resolveGatewayPort,
  resolveHooksInfo,
  resolveRegisterIp,
  DEFAULT_GATEWAY_PORT,
} from "./resolve-endpoint.js";
export { deepMerge } from "./merge-deep.js";
export { formatTimestampYyyyMMddHHmmss } from "./format-timestamp.js";
export {
  buildNacosConfigClientOptions,
  expandDataIdTemplate,
  resolveProfile,
  resolveServerAddr,
} from "./nacos-connection.js";
export { parseNacosPluginConfig } from "./config-parse.js";
export {
  flattenSpringNacosPluginConfig,
  resolveConfigServerList,
  resolveNamingServerList,
} from "./spring-normalize.js";
export { WebhookClusterService } from "./nacos-cluster.js";
export { createNacosSdkLogger, DEFAULT_GROUP, DEFAULT_NAMESPACE, DEFAULT_SERVICE, isPlainObject, tryCloseNacosClient } from "./shared.js";
export type { ClusterPeer, NacosPluginConfig, OpenClawConfigSlice, PluginLog } from "./types.js";

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

/** Module-level cluster service reference for HTTP routes. */
let activeClusterService: WebhookClusterService | null = null;

/**
 * Nacos Config Center: pull, merge, backup, replaceConfig, subscribe.
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
            api.runtime.config.replaceConfigFile(next, { afterWrite: { mode: "auto" } }) as unknown as Promise<void>,
          stateDir: ctx.stateDir,
          logger: ctx.logger,
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
        await sync.stop(ctx.logger);
        sync = null;
      }
      healthState.configSyncRunning = false;
    },
  });
}

/**
 * Nacos naming: register Gateway instance with Hooks metadata.
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
          logger: ctx.logger,
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
        await registry.stop(ctx.logger);
        registry = null;
      }
      healthState.namingRegistered = false;
    },
  });
}

/**
 * Nacos Cluster Discovery: subscribe to naming changes and maintain live peer list.
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
          logger: ctx.logger,
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
        await cluster.stop(ctx.logger);
        cluster = null;
      }
      activeClusterService = null;
      healthState.clusterDiscoveryRunning = false;
    },
  });
}

export default definePluginEntry({
  id: "openclaw-nacos",
  name: "Nacos gateway registration",
  description:
    "Nacos Config Center (merge, backup, subscribe) and Gateway/Hooks naming registration",
  configSchema: emptyPluginConfigSchema,
  reload: {
    restartPrefixes: [...NACOS_PLUGIN_RELOAD.restartPrefixes],
    hotPrefixes: [...NACOS_PLUGIN_RELOAD.hotPrefixes],
  },
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
      method: "GET",
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
      method: "GET",
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
