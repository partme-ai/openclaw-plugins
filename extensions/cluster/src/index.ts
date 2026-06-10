/**
 * @fileoverview OpenClaw Gateway「集群协调」基础设施插件入口模块。
 *
 * @description 在 Gateway 进程中装配 discovery / config-sync / session-store / proxy 四层能力，
 * 并向宿主注册 `/cluster/*` HTTP 运维面与健康观测接口；与 Erlang OTP / RabbitMQ 风格的分布式拓扑类比，
 * 本插件负责「成员视图 + 配置传播 + 会话粘性路由依据 + 节点间转发通道」的胶水层。
 *
 * **架构分层（infra plugin 视角）**
 * - **discovery**：维护集群成员列表，变更时驱动 proxy 路由表刷新。
 * - **config-sync**：在多副本间对齐 Gateway 配置（etcd KV / 共享文件系统等）。
 * - **session-store**：为多节点会话粘性或迁移提供共享视图（Redis / PostgreSQL / 内存降级）。
 * - **proxy**：承载节点间消息转发传输层（默认可用 HTTP；gRPC 另行实现）。
 *
 * **对外 HTTP API（运维 / 可观测性）**
 * - `GET /cluster/status` — 集群概要（节点数、后端类型、运行时长等）。
 * - `GET /cluster/nodes` — 当前已知节点列表。
 * - `GET|POST /cluster/config` — 查询或推送配置（推送依赖 config-sync 实现）。
 * - `GET /cluster/sessions` — 基于 discovery 负载字段的会话分布快照。
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
} from "./shared/types.js";
import { createDiscoveryService } from "./discovery/discovery.js";
import { createConfigSyncService } from "./config-sync/config-sync.js";
import { createSessionStoreService } from "./session-store/session-store.js";
import { createProxyService } from "./proxy/proxy.js";
import type { HttpProxyServer } from "./proxy/http-proxy.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { writeFile } from "node:fs/promises";
import type { GatewayRuntime } from "./shared/types.js";

/**
 * @description Gateway 未提供 `cluster.*` 配置段落时的安全默认值；保证工厂函数总能构造合法结构。
 */
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

/**
 * @description 子系统句柄缓存：`discoveryService`/`configSyncService`/`sessionStoreService`/`proxyService`
 * 供 HTTP 处理器、`SIGTERM`/`SIGINT` 钩子共享；全部为 nullable 以便在未初始化阶段短路。
 */
let discoveryService: IDiscoveryService | null = null;
let configSyncService: IConfigSyncService | null = null;
let sessionStoreService: ISessionStoreService | null = null;
let proxyService: IProxyService | null = null;

/** @description `resolveClusterConfig` 之后的运行时快照；HTTP handler 只读该副本避免竞态。 */
let activeConfig: ClusterConfig = DEFAULT_CONFIG;

/** @description 插件启动时刻（毫秒），用于 `/cluster/status` 中的 `uptimeSeconds`。 */
let startTime: number = Date.now();

/**
 * @description 兼容不同宿主版本的启动钩子：`registerService`（结构化生命周期）优于 `onReady`，
 * 若皆不可用则在微任务队列异步启动，避免阻塞插件注册线程。
 *
 * @param api - Gateway 注入的插件 API（duck-typing 探测可选方法）。
 * @param name - 注册的服务标识，便于宿主侧日志关联。
 * @param callback - 异步集群初始化逻辑。
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
 * @description `GET /cluster/status`：聚合 discovery 节点视图与本节点元数据，给出运维可读的健康快照。
 *
 * @remarks `healthy` 在静态发现且无节点时仍视为 true（开发友好）；动态发现则以是否存在节点近似判断。
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
 * @description `GET /cluster/nodes`：返回 discovery 缓存的节点数组浅拷贝视图（JSON 序列化输出）。
 */
function nodesHandler(_req: IncomingMessage, res: ServerResponse): void {
  const nodes = discoveryService?.getNodes() ?? [];

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, data: nodes }));
}

/**
 * @description `GET /cluster/config` 输出当前生效后端类型摘要；`POST /cluster/config` 将 JSON body 交由
 * `IConfigSyncService.pushConfig` 全网扩散（若无同步服务则 503）。
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
 * @description `GET /cluster/sessions`：基于 discovery 报告的 `activeSessions/activeConnections` 字段做简易汇总；
 * 并非所有发现后端都会填充真实计数，主要用于联调可视化。
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

/** @description 配置扇出可能在共享 FS / etcd 轮询场景下短时重复触发；防抖合并为单次落盘 + reload。 */
let configReloadTimer: ReturnType<typeof setTimeout> | null = null;
const CONFIG_RELOAD_DEBOUNCE_MS = 2000;

/**
 * @description 从 `GatewayRuntime.config` 的隐藏字段中提取真实配置文件路径，供 etcd-kv 回写本地 JSON。
 *
 * @returns 解析到的绝对或相对路径；未知时返回 `null`（仅能触发 reload 钩子而无法持久化）。
 */
function resolveConfigFilePath(runtime: GatewayRuntime): string | null {
  const c = runtime.config as Record<string, unknown>;
  if (typeof c._configPath === "string") return c._configPath;
  if (typeof c.configFile === "string") return c.configFile;
  return null;
}

/**
 * @description 尽量调用宿主暴露的配置热加载 API；若无则打印提示依赖文件监听。
 *
 * @remarks 方法名字符串与宿主实现耦合，属于集成契约而非集群算法的一部分。
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
 * @description config-sync 回调统一入口：`etcd-kv` 模式下先把 JSON 写入本地配置文件再 reload；
 * 其他模式可直接依赖宿主 watcher。
 *
 * @param runtime - Gateway 运行时句柄。
 * @param syncType - 当前 `ClusterConfig.configSync.type` 字符串（用于分支判定）。
 * @param newConfig - 对端合并后的完整配置对象。
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
 * @description 小型 HTTP helper：聚合 `data` 事件缓冲为 UTF-8 字符串。
 *
 * @param req - Node.js `IncomingMessage`。
 * @returns 完整 body；出错时 Promise reject。
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
 * @description 将宿主 `config.cluster` 片段与 `DEFAULT_CONFIG` 深度合并，避免遗漏字段导致工厂函数异常。
 *
 * @param globalConfig - OpenClaw 顶层配置对象。
 * @returns 可用于创建各子服务的完整 `ClusterConfig`。
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
 * @description **基础设施插件公共入口**：注册路由、拉起子系统、挂载进程信号优雅停机。
 *
 * @param api - Gateway 注入的 `PluginApi`（最小 duck-typing 表面：`runtime`、`registerHttpRoute`）。
 *
 * @public 作为默认导出由插件加载器 `import()` 调用；请勿从此模块再导出第二个默认函数以免破坏契约。
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
