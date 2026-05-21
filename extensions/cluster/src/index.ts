/**
 * openclaw-cluster 插件入口
 *
 * 多节点 OpenClaw Gateway 集群协调插件。
 * 参考 RabbitMQ clustering 和 Erlang OTP 分布式模型设计。
 *
 * 核心功能模块：
 * - discovery     -- 节点发现与注册（static / etcd / DNS SRV）
 * - config-sync   -- 配置变更跨节点同步（etcd KV / shared FS）
 * - session-store -- 共享会话状态（memory / Redis / PostgreSQL）
 * - proxy         -- 节点间 HTTP 消息路由
 *
 * 集群 API 端点：
 * - GET /cluster/status      -- 集群状态概览（节点数、健康状态、leader）
 * - GET /cluster/nodes       -- 节点详细列表
 * - GET /cluster/config      -- 当前同步配置版本
 * - POST /cluster/config     -- 推送配置变更
 * - GET /cluster/sessions    -- Session 分布统计
 */

import type {
  PluginApi,
  ClusterConfig,
  ClusterStatus,
  ClusterNodeInfo,
  IDiscoveryService,
  IConfigSyncService,
  ISessionStoreService,
  IProxyService,
} from "./types.js";
import { createDiscoveryService } from "./discovery/discovery.js";
import { createConfigSyncService } from "./config-sync/config-sync.js";
import { createSessionStoreService } from "./session-store/session-store.js";
import { createProxyService } from "./proxy/proxy.js";
import type { HttpProxyServer } from "./proxy/http-proxy.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { writeFile } from "node:fs/promises";
import type { GatewayRuntime } from "./types.js";

/** 默认集群配置 */
const DEFAULT_CONFIG: ClusterConfig = {
  nodeId: `node-${Date.now()}`,
  discovery: {
    type: "static",
    staticNodes: [],
    heartbeatInterval: 5_000,
    nodeTimeout: 15_000,
  },
  configSync: {
    type: "none",
  },
  sessionStore: {
    type: "memory",
    sessionTtl: 3600,
  },
  proxy: {
    port: 18790,
    protocol: "http",
    timeout: 5_000,
  },
};

// ======================== 模块级状态 ========================

/** 各子服务的引用（用于 API 查询和优雅关闭） */
let discoveryService: IDiscoveryService | null = null;
let configSyncService: IConfigSyncService | null = null;
let sessionStoreService: ISessionStoreService | null = null;
let proxyService: IProxyService | null = null;

/** 当前生效的集群配置 */
let activeConfig: ClusterConfig = DEFAULT_CONFIG;

/** 启动时间 */
let startTime: number = Date.now();

/**
 * 安全的 onReady 替代方案
 * 优先 registerService → onReady → 延迟执行
 */
function safeOnReady(api: PluginApi, name: string, callback: () => Promise<void>): void {
  const a = api as unknown as Record<string, unknown>;
  if (typeof a.registerService === "function") {
    (a.registerService as (def: { id: string; start: () => Promise<void> }) => void)({ id: name, start: callback });
  } else if (typeof a.onReady === "function") {
    (a.onReady as (cb: () => Promise<void>) => void)(callback);
  } else {
    Promise.resolve().then(() => callback()).catch((e) => console.error(`[${name}] Startup error:`, e));
  }
}

// ======================== HTTP 处理器 ========================

/**
 * 处理集群状态查询
 */
function statusHandler(_req: IncomingMessage, res: ServerResponse): void {
  const nodes = discoveryService?.getNodes() ?? [];

  const status: ClusterStatus = {
    selfNodeId: activeConfig.nodeId,
    nodes,
    healthy: nodes.length > 0 || activeConfig.discovery.type === "static",
    leaderId: undefined,
  };

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      ok: true,
      data: {
        ...status,
        totalNodes: nodes.length,
        onlineNodes: nodes.filter((n) => n.status === "online").length,
        discovery: activeConfig.discovery.type,
        configSync: activeConfig.configSync.type,
        sessionStore: activeConfig.sessionStore.type,
        proxyPort: activeConfig.proxy.port,
        uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
      },
    })
  );
}

/**
 * 处理节点列表查询
 */
function nodesHandler(_req: IncomingMessage, res: ServerResponse): void {
  const nodes = discoveryService?.getNodes() ?? [];

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, data: nodes }));
}

/**
 * 处理配置查询/推送
 */
async function configHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === "GET") {
    // 返回当前集群配置
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        data: {
          nodeId: activeConfig.nodeId,
          discovery: activeConfig.discovery.type,
          configSync: activeConfig.configSync.type,
          sessionStore: activeConfig.sessionStore.type,
        },
      })
    );
    return;
  }

  if (req.method === "POST") {
    // 推送配置变更
    if (!configSyncService) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Config sync service not available" }));
      return;
    }

    const body = await readBody(req);
    try {
      const newConfig = JSON.parse(body) as Record<string, unknown>;
      await configSyncService.pushConfig(newConfig);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: "Configuration pushed to cluster" }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
    }
    return;
  }

  res.writeHead(405, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
}

/**
 * 处理 Session 分布查询
 */
function sessionsHandler(_req: IncomingMessage, res: ServerResponse): void {
  const nodes = discoveryService?.getNodes() ?? [];

  const distribution = nodes.map((n) => ({
    nodeId: n.nodeId,
    activeSessions: n.activeSessions,
    activeConnections: n.activeConnections,
  }));

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      ok: true,
      data: {
        totalSessions: distribution.reduce((sum, n) => sum + n.activeSessions, 0),
        totalConnections: distribution.reduce((sum, n) => sum + n.activeConnections, 0),
        distribution,
      },
    })
  );
}

// ======================== 配置重载 ========================

/** 配置变更防抖定时器 */
let configReloadTimer: ReturnType<typeof setTimeout> | null = null;
const CONFIG_RELOAD_DEBOUNCE_MS = 2000;

/**
 * 解析当前节点的配置文件路径
 * 用于 etcd 同步时将拉取的配置写回本地文件后触发重载
 */
function resolveConfigFilePath(runtime: GatewayRuntime): string | null {
  const c = runtime.config as Record<string, unknown>;
  if (typeof c._configPath === "string") return c._configPath;
  if (typeof c.configFile === "string") return c.configFile;
  return null;
}

/**
 * 触发 Gateway 配置重载
 * 优先 gatewayCall("config.reload")，其次 invoke("config_reload")
 */
async function triggerConfigReload(runtime: GatewayRuntime): Promise<void> {
  const r = runtime as unknown as Record<string, unknown>;
  try {
    if (typeof r.gatewayCall === "function") {
      await (r.gatewayCall as (m: string) => Promise<unknown>)("config.reload");
      console.log("[openclaw-cluster] Config reload triggered via gatewayCall");
      return;
    }
    if (typeof r.invoke === "function") {
      await (r.invoke as (m: string) => Promise<unknown>)("config_reload");
      console.log("[openclaw-cluster] Config reload triggered via invoke");
      return;
    }
    console.log(
      "[openclaw-cluster] Config changed. No reload API — rely on Gateway file watcher."
    );
  } catch (err) {
    console.error("[openclaw-cluster] Config reload failed:", err);
  }
}

/**
 * 配置同步变更回调：写回本地文件（仅 etcd 需写回）+ 触发重载
 */
async function onClusterConfigChange(
  runtime: GatewayRuntime,
  syncType: string,
  newConfig: Record<string, unknown>
): Promise<void> {
  if (configReloadTimer) clearTimeout(configReloadTimer);

  configReloadTimer = setTimeout(async () => {
    configReloadTimer = null;
    try {
      if (syncType === "etcd-kv") {
        const configPath = resolveConfigFilePath(runtime);
        if (configPath) {
          await writeFile(
            configPath,
            JSON.stringify(newConfig, null, 2),
            "utf-8"
          );
          console.log("[openclaw-cluster] Config written to local file, triggering reload");
        } else {
          console.warn(
            "[openclaw-cluster] etcd sync: no config file path in runtime, cannot write; trigger reload only."
          );
        }
      }
      await triggerConfigReload(runtime);
    } catch (err) {
      console.error("[openclaw-cluster] Config change apply failed:", err);
    }
  }, CONFIG_RELOAD_DEBOUNCE_MS);
}

// ======================== 工具函数 ========================

/**
 * 读取 HTTP 请求体
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/**
 * 从全局配置中解析集群配置
 *
 * @param globalConfig - OpenClaw 全局配置
 * @returns 合并后的集群配置
 */
function resolveClusterConfig(
  globalConfig: Record<string, unknown>
): ClusterConfig {
  const cluster = globalConfig.cluster as Partial<ClusterConfig> | undefined;

  return {
    nodeId: cluster?.nodeId ?? DEFAULT_CONFIG.nodeId,
    discovery: {
      ...DEFAULT_CONFIG.discovery,
      ...cluster?.discovery,
    },
    configSync: {
      ...DEFAULT_CONFIG.configSync,
      ...cluster?.configSync,
    },
    sessionStore: {
      ...DEFAULT_CONFIG.sessionStore,
      ...cluster?.sessionStore,
    },
    proxy: {
      ...DEFAULT_CONFIG.proxy,
      ...cluster?.proxy,
    },
  };
}

// ======================== 插件注册 ========================

/**
 * 插件注册入口
 * 由 OpenClaw Gateway 在加载插件时调用
 *
 * @param api - Gateway 注入的插件 API
 */
export default function register(api: PluginApi): void {
  // ──────────── 注册 HTTP API 端点 ────────────
  api.registerHttpRoute({ path: "/cluster/status", handler: statusHandler });
  api.registerHttpRoute({ path: "/cluster/nodes", handler: nodesHandler });
  api.registerHttpRoute({ path: "/cluster/config", handler: configHandler });
  api.registerHttpRoute({ path: "/cluster/sessions", handler: sessionsHandler });

  // ──────────── 启动集群服务 ────────────
  const startClusterService = async () => {
    startTime = Date.now();
    activeConfig = resolveClusterConfig(api.runtime.config);

    console.log(`[openclaw-cluster] Node ID: ${activeConfig.nodeId}`);
    console.log(`[openclaw-cluster] Discovery: ${activeConfig.discovery.type}`);
    console.log(`[openclaw-cluster] Config sync: ${activeConfig.configSync.type}`);
    console.log(`[openclaw-cluster] Session store: ${activeConfig.sessionStore.type}`);
    console.log(`[openclaw-cluster] Proxy: ${activeConfig.proxy.protocol} on port ${activeConfig.proxy.port}`);

    try {
      // 1. 启动节点发现
      discoveryService = createDiscoveryService(activeConfig.discovery, activeConfig.nodeId);
      await discoveryService.start();

      // 2. 启动配置同步
      configSyncService = createConfigSyncService(activeConfig.configSync);
      await configSyncService.start();
      // 配置变更时触发本节点重载（shared-fs 重读文件，etcd-kv 写回本地后重载）
      configSyncService.onConfigChange((newConfig) => {
        void onClusterConfigChange(
          api.runtime as GatewayRuntime,
          activeConfig.configSync.type,
          newConfig
        );
      });

      // 3. 启动会话存储
      sessionStoreService = createSessionStoreService(
        activeConfig.sessionStore,
        activeConfig.nodeId
      );
      await sessionStoreService.start();

      // 4. 启动代理服务
      proxyService = createProxyService(activeConfig.proxy);
      await proxyService.start();

      // 5. 连接 discovery → proxy：当节点变化时更新代理的路由表
      discoveryService.onNodeChange((nodes: ClusterNodeInfo[]) => {
        console.log(`[openclaw-cluster] Node list updated: ${nodes.length} node(s)`);
        if (proxyService && "updateNodes" in proxyService) {
          (proxyService as HttpProxyServer).updateNodes(nodes);
        }
      });

      console.log("[openclaw-cluster] All cluster services initialized successfully");
    } catch (err) {
      console.error("[openclaw-cluster] Failed to initialize cluster services:", err);
    }
  };
  safeOnReady(api, "cluster-init", startClusterService);

  // ──────────── 优雅关闭 ────────────
  const shutdown = async () => {
    console.log("[openclaw-cluster] Shutting down cluster services...");

    try {
      if (proxyService) await proxyService.stop();
      if (sessionStoreService) await sessionStoreService.stop();
      if (configSyncService) await configSyncService.stop();
      if (discoveryService) await discoveryService.stop();
      console.log("[openclaw-cluster] All cluster services stopped");
    } catch (err) {
      console.error("[openclaw-cluster] Error during shutdown:", err);
    }
  };

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());

  console.log("[openclaw-cluster] Plugin registered — cluster coordination");
  console.log("[openclaw-cluster] Endpoints:");
  console.log("  GET  /cluster/status   -- Cluster overview");
  console.log("  GET  /cluster/nodes    -- Node list");
  console.log("  GET  /cluster/config   -- Configuration info");
  console.log("  POST /cluster/config   -- Push config change");
  console.log("  GET  /cluster/sessions -- Session distribution");
}
