/**
 * openclaw-cluster 核心类型定义
 * 集群协调层所需的数据结构和接口
 *
 * 注意：此为骨架定义，接口设计阶段，尚未实现具体逻辑。
 */

import type { IncomingMessage, ServerResponse } from "node:http";

// ─────────────────── OpenClaw Plugin API 类型 ───────────────────

/**
 * OpenClaw 插件 API 接口
 */
export interface PluginApi {
  /** Gateway 运行时实例 */
  runtime: GatewayRuntime;

  /** 注册 HTTP 路由端点 */
  registerHttpRoute(route: HttpRouteDefinition): void;

}

/**
 * HTTP 路由定义
 */
export interface HttpRouteDefinition {
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
}

/**
 * Gateway 运行时
 */
export interface GatewayRuntime {
  /** 当前配置 */
  config: Record<string, unknown>;
  /** 可选：Gateway 内部调用（如 config.reload） */
  gatewayCall?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  /** 可选：通用调用 */
  invoke?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
}

// ─────────────────── 集群配置类型 ───────────────────

/**
 * 集群配置
 */
export interface ClusterConfig {
  /** 当前节点 ID（唯一标识） */
  nodeId: string;
  /** 节点发现方式 */
  discovery: DiscoveryConfig;
  /** 配置同步方式 */
  configSync: ConfigSyncConfig;
  /** 共享会话存储方式 */
  sessionStore: SessionStoreConfig;
  /** 节点间通信配置 */
  proxy: ProxyConfig;
}

/**
 * 节点发现配置
 */
export interface DiscoveryConfig {
  /** 发现方式：static / etcd / dns-srv / consul / nacos / redis / eureka / mdns */
  type:
    | "static"
    | "etcd"
    | "dns-srv"
    | "consul"
    | "nacos"
    | "redis"
    | "eureka"
    | "mdns";
  /** 静态节点列表（type=static 时使用） */
  staticNodes?: string[];
  /** etcd 端点（type=etcd 时使用） */
  etcdEndpoints?: string[];
  /** DNS SRV 域名（type=dns-srv 时使用） */
  dnsDomain?: string;
  /** Consul Agent 地址（type=consul 时使用） */
  consulAddress?: string;
  /** Consul 服务名（type=consul 时使用） */
  consulServiceName?: string;
  /** Consul 数据中心 / ACL Token（可选） */
  consulDatacenter?: string;
  consulToken?: string;
  /** Nacos 服务地址（type=nacos 时使用，如 http://localhost:8848） */
  nacosAddress?: string;
  /** Nacos 服务名（默认 openclaw-gateway） */
  nacosServiceName?: string;
  /** Nacos 命名空间 ID（可选） */
  nacosNamespace?: string;
  /** Nacos 分组（可选，默认 DEFAULT_GROUP） */
  nacosGroupName?: string;
  /** Redis URL（type=redis 时使用，如 redis://localhost:6379） */
  redisUrl?: string;
  /** Redis 节点键前缀（默认 openclaw:cluster:nodes） */
  redisKeyPrefix?: string;
  /** Eureka Server 地址（type=eureka 时使用，如 http://localhost:8761/eureka） */
  eurekaAddress?: string;
  /** Eureka 应用名（默认 OPENCLAW-GATEWAY） */
  eurekaAppName?: string;
  /** mDNS 服务类型（type=mdns 时使用，默认 _openclaw._tcp.local） */
  mdnsServiceType?: string;
  /** 心跳/刷新间隔（毫秒） */
  heartbeatInterval?: number;
  /** 节点超时时间（毫秒） */
  nodeTimeout?: number;
}

/**
 * 配置同步配置
 */
export interface ConfigSyncConfig {
  /** 同步方式：etcd-kv / shared-fs / none */
  type: "etcd-kv" | "shared-fs" | "none";
  /** etcd 端点（type=etcd-kv 时使用） */
  etcdEndpoints?: string[];
  /** 共享文件系统路径（type=shared-fs 时使用） */
  sharedPath?: string;
  /** 同步间隔（毫秒） */
  syncInterval?: number;
}

/**
 * 共享会话存储配置
 */
export interface SessionStoreConfig {
  /** 存储方式：redis / postgresql / memory */
  type: "redis" | "postgresql" | "memory";
  /** Redis URL（type=redis 时使用） */
  redisUrl?: string;
  /** PostgreSQL URL（type=postgresql 时使用） */
  postgresUrl?: string;
  /** Session TTL（秒） */
  sessionTtl?: number;
}

/**
 * 节点间代理配置
 */
export interface ProxyConfig {
  /** 代理端口 */
  port: number;
  /** 协议：grpc / http */
  protocol: "grpc" | "http";
  /** 超时（毫秒） */
  timeout?: number;
}

// ─────────────────── 节点信息类型 ───────────────────

/**
 * 集群节点信息
 */
export interface ClusterNodeInfo {
  /** 节点 ID */
  nodeId: string;
  /** 节点地址 */
  address: string;
  /** 节点端口 */
  port: number;
  /** 节点状态 */
  status: "online" | "offline" | "suspect";
  /** 最后心跳时间 */
  lastHeartbeat: string;
  /** 负载（活跃会话数） */
  activeSessions: number;
  /** 负载（活跃连接数） */
  activeConnections: number;
  /** 节点加入时间 */
  joinedAt: string;
}

/**
 * 集群状态概览
 */
export interface ClusterStatus {
  /** 当前节点 ID */
  selfNodeId: string;
  /** 集群中的节点列表 */
  nodes: ClusterNodeInfo[];
  /** 集群是否健康 */
  healthy: boolean;
  /** Leader 节点 ID（如果使用选举） */
  leaderId?: string;
}

// ─────────────────── 接口定义（供各子模块实现） ───────────────────

/**
 * 节点发现接口
 */
export interface IDiscoveryService {
  /** 启动发现服务 */
  start(): Promise<void>;
  /** 停止发现服务 */
  stop(): Promise<void>;
  /** 获取当前已知节点 */
  getNodes(): ClusterNodeInfo[];
  /** 注册节点变更监听 */
  onNodeChange(callback: (nodes: ClusterNodeInfo[]) => void): void;
}

/**
 * 配置同步接口
 */
export interface IConfigSyncService {
  /** 启动配置同步 */
  start(): Promise<void>;
  /** 停止配置同步 */
  stop(): Promise<void>;
  /** 推送配置变更 */
  pushConfig(config: Record<string, unknown>): Promise<void>;
  /** 注册配置变更监听 */
  onConfigChange(callback: (config: Record<string, unknown>) => void): void;
}

/**
 * 共享会话存储接口
 */
export interface ISessionStoreService {
  /** 启动存储服务 */
  start(): Promise<void>;
  /** 停止存储服务 */
  stop(): Promise<void>;
  /** 获取 Session 所在节点 */
  getSessionNode(sessionKey: string): Promise<string | null>;
  /** 注册 Session 到当前节点 */
  registerSession(sessionKey: string): Promise<void>;
  /** 移除 Session */
  removeSession(sessionKey: string): Promise<void>;
}

/**
 * 节点间代理接口
 */
export interface IProxyService {
  /** 启动代理服务 */
  start(): Promise<void>;
  /** 停止代理服务 */
  stop(): Promise<void>;
  /** 转发消息到指定节点 */
  forwardMessage(
    targetNodeId: string,
    sessionKey: string,
    message: string
  ): Promise<void>;
}
