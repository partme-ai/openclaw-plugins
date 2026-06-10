/**
 * @fileoverview OpenClaw `cluster` 插件共享类型契约。
 *
 * @description 定义宿主注入的最小插件 API、`ClusterConfig` 与各子领域服务接口。
 * 这些类型是 discovery / config-sync / session-store / proxy 实现与入口编排层之间的编译期契约，
 * 不包含任何运行时逻辑。历史上部分字段为占位设计，仍以注释标明扩展方向。
 */

import type { IncomingMessage, ServerResponse } from "node:http";

// ─────────────────── OpenClaw Plugin API 类型 ───────────────────

/**
 * @description Gateway 暴露给 infra 插件的最小宿主面：运行时上下文 + HTTP 路由挂载。
 *
 * @remarks 具体 Gateway 可能还会注入 `registerService`、`onReady` 等可选方法；
 * `index.ts` 通过 duck-typing 读取，不强制体现在此接口中。
 */
export interface PluginApi {
  /** @description Gateway 运行时（配置、可选内部 RPC）。 */
  runtime: GatewayRuntime;

  /** @description 将处理器绑定到 Gateway HTTP 服务器的指定路径前缀之后。 */
  registerHttpRoute(route: HttpRouteDefinition): void;

}

/**
 * @description HTTP 挂载点的路径字面量与异步/同步处理器二元组。
 */
export interface HttpRouteDefinition {
  /** @description URL pathname（例如 `/cluster/status`）。 */
  path: string;
  /** @description Express-like handler；返回 Promise 时 Gateway 应等待 settled。 */
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
}

/**
 * @description `PluginApi.runtime` 的结构化视图；字段均为可选派生，避免强耦合具体 Gateway 版本。
 */
export interface GatewayRuntime {
  /** @description 当前载入并合并后的全局配置（包含隐藏字段如 `_configPath`）。 */
  config: Record<string, unknown>;
  /** @description 可选：Gateway 内部统一 RPC（如 `config.reload`）。 */
  gatewayCall?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  /** @description 可选：历史兼容调用入口。 */
  invoke?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
}

// ─────────────────── 集群配置类型 ───────────────────

/**
 * @description 描述单个 Gateway 副本在集群中的角色及其依赖的外部协调后端。
 *
 * **字段映射概览**
 * - `discovery` —— 如何发现同伴节点；
 * - `configSync` —— 如何在副本间对齐配置文件；
 * - `sessionStore` —— 如何把会话映射到节点；
 * - `proxy` —— 节点间消息平面监听参数。
 */
export interface ClusterConfig {
  /** @description 逻辑节点 ID（应全局唯一）；会写入各注册后端。 */
  nodeId: string;
  /** @description 节点发现子系统配置。 */
  discovery: DiscoveryConfig;
  /** @description 配置传播子系统配置。 */
  configSync: ConfigSyncConfig;
  /** @description 共享会话索引子系统配置。 */
  sessionStore: SessionStoreConfig;
  /** @description 节点间转发代理监听参数。 */
  proxy: ProxyConfig;
}

/**
 * @description `createDiscoveryService` 的路由输入；不同 `type` 激活 mutually exclusive 字段集合。
 */
export interface DiscoveryConfig {
  /**
   * @description 发现实现选择器。
   *
   * - `static` —— 运维显式列举同伴；
   * - `etcd` / `dns-srv` / `consul` / `nacos` / `redis` / `eureka` / `mdns` —— 各类注册中心或局域网广播。
   */
  type:
    | "static"
    | "etcd"
    | "dns-srv"
    | "consul"
    | "nacos"
    | "redis"
    | "eureka"
    | "mdns";
  /** @description `static`：`host:port` 字面量列表。 */
  staticNodes?: string[];
  /** @description `etcd`：HTTP v3 API 端点列表。 */
  etcdEndpoints?: string[];
  /** @description `dns-srv`：要查询的 SRV 名称。 */
  dnsDomain?: string;
  /** @description `consul`：Agent HTTP API 根地址。 */
  consulAddress?: string;
  /** @description `consul`：服务注册名。 */
  consulServiceName?: string;
  /** @description `consul`：数据中心 ID。 */
  consulDatacenter?: string;
  /** @description `consul`：ACL token。 */
  consulToken?: string;
  /** @description `nacos`：Open API 根 URL。 */
  nacosAddress?: string;
  /** @description `nacos`：逻辑服务名。 */
  nacosServiceName?: string;
  /** @description `nacos`：命名空间 ID。 */
  nacosNamespace?: string;
  /** @description `nacos`：分组名。 */
  nacosGroupName?: string;
  /** @description `redis`：`redis://` URL。 */
  redisUrl?: string;
  /** @description `redis`：键前缀（集合成员 + per-node KV）。 */
  redisKeyPrefix?: string;
  /** @description `eureka`：注册中心 base path（包含 `/eureka` 后缀）。 */
  eurekaAddress?: string;
  /** @description `eureka`：大写 application 名。 */
  eurekaAppName?: string;
  /** @description `mdns`：PTR/SRV 服务类型字符串。 */
  mdnsServiceType?: string;
  /** @description 注册续约或轮询节奏（毫秒）；语义随实现略有差异。 */
  heartbeatInterval?: number;
  /** @description 下游判定失效的超时阈值（毫秒）；用于 TTL、 suspect 标记等。 */
  nodeTimeout?: number;
}

/**
 * @description 控制配置如何在副本之间达成一致。
 */
export interface ConfigSyncConfig {
  /** @description `none` 禁用；`etcd-kv` 使用固定 KV；`shared-fs` 依赖 POSIX 文件与可选锁。 */
  type: "etcd-kv" | "shared-fs" | "none";
  /** @description `etcd-kv` 端点列表。 */
  etcdEndpoints?: string[];
  /** @description `shared-fs` 监视目录（需多方挂载同一存储）。 */
  sharedPath?: string;
  /** @description 轮询或防抖相关的毫秒间隔。 */
  syncInterval?: number;
}

/**
 * @description Session 粘性路由的外部真相来源（Shared nothing / Shared everything 之间的折中）。
 */
export interface SessionStoreConfig {
  /** @description `memory` 仅测试；生产常用 `redis` 或 `postgresql`。 */
  type: "redis" | "postgresql" | "memory";
  /** @description Redis DSN。 */
  redisUrl?: string;
  /** @description PostgreSQL DSN（依赖可选 `pg` 模块）。 */
  postgresUrl?: string;
  /** @description 会话映射 TTL（秒）。 */
  sessionTtl?: number;
}

/**
 * @description 节点间「消息平面」监听端口与超时；与 Gateway 面向用户的 HTTP/gRPC 端口解耦。
 */
export interface ProxyConfig {
  /** @description 本地 bind 端口。 */
  port: number;
  /** @description `http` 为当前默认完整实现；`grpc` 需可选依赖并可降级。 */
  protocol: "grpc" | "http";
  /** @description 出站 RPC/HTTP 调用的毫秒超时。 */
  timeout?: number;
}

// ─────────────────── 节点信息类型 ───────────────────

/**
 * @description Discovery 抽象的统一节点视图；额外负载字段可被 `/cluster/sessions` 汇总。
 */
export interface ClusterNodeInfo {
  /** @description 与注册后端一致的节点唯一键。 */
  nodeId: string;
  /** @description L3/L4 可达地址（可能是主机名）。 */
  address: string;
  /** @description `proxy` 平面端口（默认为插件约定端口）。 */
  port: number;
  /** @description 成员状态机：`online` / `offline` / `suspect`。 */
  status: "online" | "offline" | "suspect";
  /** @description ISO-8601 时间戳字符串，供 UI 排序。 */
  lastHeartbeat: string;
  /** @description 活跃会话计数（实现可恒为 0）。 */
  activeSessions: number;
  /** @description 活跃 TCP/WebSocket 连接估计。 */
  activeConnections: number;
  /** @description 节点首次_seen 时间。 */
  joinedAt: string;
}

/**
 * @description `/cluster/status` 返回体的领域模型子集。
 */
export interface ClusterStatus {
  /** @description 本进程 `ClusterConfig.nodeId`。 */
  selfNodeId: string;
  /** @description 当前缓存的全部成员。 */
  nodes: ClusterNodeInfo[];
  /** @description 聚合健康比特；具体判定规则由编排层给出。 */
  healthy: boolean;
  /** @description 预留：若引入 raft/etcd 选举，可填充稳定 leader ID。 */
  leaderId?: string;
}

// ─────────────────── 接口定义（供各子模块实现） ───────────────────

/**
 * @description 节点成员子系统契约：生命周期 + 只读快照 + 推送变更事件。
 */
export interface IDiscoveryService {
  /** @description 建立与外部后端的会话并开始续约/轮询。 */
  start(): Promise<void>;
  /** @description 释放资源；应幂等。 */
  stop(): Promise<void>;
  /** @description 返回防御性拷贝或稳定快照（由实现决定）。 */
  getNodes(): ClusterNodeInfo[];
  /** @description 注册拓扑变更观察者；不得假设回调同步执行。 */
  onNodeChange(callback: (nodes: ClusterNodeInfo[]) => void): void;
}

/**
 * @description 配置传播子系统：把 JSON 可比对象写入共享媒介并回调本节点。
 */
export interface IConfigSyncService {
  /** @description 打开 watcher / poll loop。 */
  start(): Promise<void>;
  /** @description 停止后台任务。 */
  stop(): Promise<void>;
  /** @description 由控制面 API 触发，向其他副本扩散。 */
  pushConfig(config: Record<string, unknown>): Promise<void>;
  /** @description 当媒介上版本前进时触发。 */
  onConfigChange(callback: (config: Record<string, unknown>) => void): void;
}

/**
 * @description 会话 → 节点映射服务；Gateway 业务层可借助其做粘性与迁移。
 */
export interface ISessionStoreService {
  /** @description 建立到底层存储的连接。 */
  start(): Promise<void>;
  /** @description 关闭连接并释放句柄。 */
  stop(): Promise<void>;
  /** @description 查询某 `sessionKey` 当前绑定的 `nodeId`。 */
  getSessionNode(sessionKey: string): Promise<string | null>;
  /** @description 将 session 绑定到「本节点」。 */
  registerSession(sessionKey: string): Promise<void>;
  /** @description 显式删除映射（例如会话结束）。 */
  removeSession(sessionKey: string): Promise<void>;
}

/**
 * @description 节点间转发通道；HTTP 实现额外提供 `updateNodes`/`onMessage` 类扩展方法。
 */
export interface IProxyService {
  /** @description 监听入站转发。 */
  start(): Promise<void>;
  /** @description 停止 server / 断开池化连接。 */
  stop(): Promise<void>;
  /**
   * @description 将一条逻辑消息投递到远端 `proxy` endpoint。
   *
   * @param targetNodeId - discovery 所知的节点 ID。
   * @param sessionKey - 会话标识，用于下游路由。
   * @param message - 透明负载（序列化由调用方决定）。
   */
  forwardMessage(
    targetNodeId: string,
    sessionKey: string,
    message: string
  ): Promise<void>;
}
