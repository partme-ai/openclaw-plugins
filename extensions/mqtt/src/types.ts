/**
 * openclaw-mqtt 核心类型定义（MQTT 协议与载荷）。
 */

// ─────────────────── MQTT 配置类型 ───────────────────

/** 入站 payload 解析模式 */
export type MqttPayloadParseMode = "jsonTextOrPlain";

/**
 * MQTT Payload 解析配置
 */
export interface MqttPayloadConfig {
  /** 解析模式，当前支持 JSON.text 优先后回退纯文本 */
  mode: MqttPayloadParseMode;
  /** 出站 wire 格式（默认 envelope） */
  outboundFormat?: "envelope" | "legacyJsonText" | "plainText";
}

/**
 * Topic 与 Agent 的显式绑定配置
 */
export interface MqttTopicBinding {
  /** Topic 匹配模式（支持 +/#） */
  topicPattern: string;
  /** 绑定的 Agent ID */
  agentId: string;
  /** 可选的 OpenClaw accountId */
  accountId?: string;
  /** 可选的固定回复 Topic */
  replyTopic?: string;
}

/**
 * MQTT Channel 配置（channels.mqtt）
 */
export interface MqttChannelConfig {
  /** TCP 监听端口 */
  port: number;
  /** WebSocket 监听端口（兼容字段，当前不启用） */
  wsPort: number;
  /** 最大连接数 */
  maxConnections: number;
  /** 认证配置 */
  auth: MqttAuthConfig;
  /** TLS 监听配置 */
  tls: MqttTlsConfig;
  /** 运行时限制配置 */
  limits: MqttLimitsConfig;
  /** 会话过期策略 */
  session: MqttSessionPolicyConfig;
  /** QoS0 软限流策略 */
  qos0: MqttQos0PolicyConfig;
  /** retain 消息策略 */
  retain: MqttRetainPolicyConfig;
  /** 审计日志策略 */
  audit: MqttAuditConfig;
  /** Will 消息策略 */
  will: MqttWillPolicyConfig;
  /** 持久化配置（支持多种后端） */
  persistence: MqttPersistenceConfig;
  /** 指定允许接收的多 Topic 订阅模式 */
  subscribeTopics: string[];
  /** 显式 Topic 绑定规则 */
  topicBindings: MqttTopicBinding[];
  /** Payload 解析策略 */
  payload: MqttPayloadConfig;
}

/**
 * MQTT Broker 配置
 */
export interface MqttBrokerConfig {
  /** TCP 端口，默认 1883 */
  port: number;
  /** WebSocket 端口，默认 8883 */
  wsPort: number;
  /** 最大连接数，默认 1000 */
  maxConnections: number;
  /** 认证配置 */
  auth: MqttAuthConfig;
  /** TLS 监听配置 */
  tls: MqttTlsConfig;
  /** 运行时限制配置 */
  limits: MqttLimitsConfig;
  /** 会话过期策略 */
  session: MqttSessionPolicyConfig;
  /** QoS0 软限流策略 */
  qos0: MqttQos0PolicyConfig;
  /** retain 消息策略 */
  retain: MqttRetainPolicyConfig;
  /** 审计日志策略 */
  audit: MqttAuditConfig;
  /** Will 消息策略 */
  will: MqttWillPolicyConfig;
  /** 持久化配置（支持多种后端） */
  persistence: MqttPersistenceConfig;
  /** 指定允许接收的多 Topic 订阅模式 */
  subscribeTopics: string[];
  /** Payload 解析策略 */
  payload: MqttPayloadConfig;
}

/**
 * MQTT 认证配置
 */
export interface MqttAuthConfig {
  /** 是否启用认证 */
  enabled: boolean;
  /** 允许匿名连接（启用认证后生效） */
  allowAnonymous?: boolean;
  /** 用户列表 */
  users: MqttUser[];
}

/**
 * TLS 监听配置
 */
export interface MqttTlsConfig {
  /** 是否启用 MQTT over TLS */
  enabled: boolean;
  /** TLS 监听端口，默认 8883 */
  port: number;
  /** 证书文件路径（PEM） */
  certFile?: string;
  /** 私钥文件路径（PEM） */
  keyFile?: string;
  /** 可选 CA 证书路径（PEM） */
  caFile?: string;
  /** 是否请求客户端证书 */
  requestCert?: boolean;
  /** 是否校验客户端证书 */
  rejectUnauthorized?: boolean;
}

/**
 * Broker 运行时限制配置
 */
export interface MqttLimitsConfig {
  /** 单条消息最大字节数（超出后拒绝） */
  maxPayloadBytes: number;
}

/**
 * 会话过期策略（参考 RabbitMQ max_session_expiry 思路）
 */
export interface MqttSessionPolicyConfig {
  /**
   * 客户端断线后会话最大保留秒数：
   * - 0: 立刻清理
   * - >0: 延迟清理
   */
  maxExpirySeconds: number;
  /** 是否允许会话跨重连保留 */
  persistentAcrossReconnect: boolean;
}

/**
 * QoS0 软限流策略（参考 RabbitMQ mailbox soft limit 思路）
 */
export interface MqttQos0PolicyConfig {
  /** QoS0 并发处理软上限（每客户端） */
  mailboxSoftLimit: number;
}

/**
 * retain 消息策略
 */
export interface MqttRetainPolicyConfig {
  /** 是否接受 retain 入站消息 */
  allowInboundRetain: boolean;
  /** Agent 回复是否使用 retain 标记 */
  outboundRetain: boolean;
}

/**
 * 审计日志配置
 */
export interface MqttAuditConfig {
  /** 是否启用审计日志 */
  enabled: boolean;
  /** 审计日志输出格式 */
  format: "json" | "text";
}

/**
 * Will 消息策略
 */
export interface MqttWillPolicyConfig {
  /** 是否允许客户端声明 Last Will */
  allow: boolean;
  /** 允许的 Will topic 模式（空数组表示不限制） */
  allowedTopicPatterns: string[];
}

/**
 * 持久化后端类型
 */
export type MqttPersistenceBackend = "memory" | "redis" | "mongodb" | "level" | "nedb";

/**
 * 持久化配置（支持多种后端）
 */
export interface MqttPersistenceConfig {
  /** 是否启用持久化 */
  enabled: boolean;
  /** 持久化后端类型 */
  backend?: MqttPersistenceBackend;
  /** Redis 配置 */
  redis?: {
    enabled?: boolean;
    host?: string;
    port?: number;
    db?: number;
    password?: string;
    keyPrefix?: string;
    subscriptionTTL?: number;
    retainedTTL?: number;
  };
  /** MongoDB 配置 */
  mongodb?: {
    url?: string;
    dbName?: string;
    collectionName?: string;
  };
  /** LevelDB 配置 */
  level?: {
    path?: string;
  };
  /** NeDB 配置 */
  nedb?: {
    path?: string;
  };
}

/**
 * MQTT 用户
 */
export interface MqttUser {
  /** 用户名 */
  username: string;
  /** 明文密码（与 passwordHash 二选一） */
  password?: string;
  /** 十六进制哈希密码（与 password 二选一） */
  passwordHash?: string;
  /** 哈希算法（默认 sha256） */
  hashAlgorithm?: "sha256" | "sha512";
  /** 允许发布的 Topic 模式 */
  publishAllow?: string[];
  /** 允许订阅的 Topic 模式 */
  subscribeAllow?: string[];
  /** 细粒度 ACL 规则（优先于 publishAllow/subscribeAllow） */
  aclRules?: MqttAclRule[];
}

/**
 * 细粒度 ACL 规则
 */
export interface MqttAclRule {
  action: "publish" | "subscribe" | "inbound" | "outbound";
  topicPattern: string;
  effect: "allow" | "deny";
  accountId?: string;
}

/**
 * OpenClaw 全局 DM 会话粒度（source: session.dmScope）
 */
export type OpenClawDmScope =
  | "main"
  | "per-peer"
  | "per-channel-peer"
  | "per-account-channel-peer";

// ─────────────────── MQTT 客户端与会话类型 ───────────────────

/**
 * MQTT 客户端信息
 * 追踪每个连接设备的状态
 */
export interface MqttClientInfo {
  /** MQTT Client ID */
  clientId: string;
  /** 用户名 */
  username?: string;
  /** 连接时间 */
  connectedAt: string;
  /** 最后活跃时间 */
  lastActiveAt: string;
  /** 关联的 Agent ID（从订阅 topic 推断） */
  agentId?: string;
  /** 关联的 OpenClaw 会话键 */
  sessionKey?: string;
  /** 客户端 IP 地址 */
  remoteAddress?: string;
}

/**
 * MQTT Topic 到 Agent 的映射规则
 */
export interface MqttTopicMapping {
  /** Topic 匹配模式（支持 + 和 # 通配符） */
  topicPattern: string;
  /** 目标 Agent ID */
  agentId: string;
  /** 可选：session scope */
  scope?: string;
  /** 可选：accountId */
  accountId?: string;
  /** 可选：固定回复 Topic */
  replyTopic?: string;
}

/**
 * 入站 Topic 路由结果
 */
export interface MqttInboundRoute {
  /** 命中的 Agent ID */
  agentId: string;
  /** accountId（默认 default） */
  accountId: string;
  /** 优先回复 Topic（可为空） */
  replyTopic?: string;
  /** 命中模式，便于日志与诊断 */
  matchedPattern: string;
  /** 命中来源 */
  source: "binding" | "standard";
}

/**
 * MQTT 入站消息（设备 -> Agent）
 */
export interface MqttInboundMessage {
  /** 来源 Topic */
  topic: string;
  /** 消息内容 */
  payload: string;
  /** 来源 Client ID */
  clientId: string;
  /** MQTT QoS */
  qos: 0 | 1 | 2;
  /** MQTT retain 标记 */
  retain: boolean;
  /** MQTT dup 标记 */
  dup: boolean;
  /** MQTT messageId */
  messageId?: number;
  /** MQTT v5 属性 */
  properties?: Record<string, unknown>;
}

/**
 * MQTT 出站消息（Agent -> 设备）
 */
export interface MqttOutboundMessage {
  /** 目标 Topic */
  topic: string;
  /** 消息内容 */
  payload: string;
  /** QoS 级别 */
  qos: 0 | 1;
  /** 是否 retain */
  retain: boolean;
}

/**
 * 会话上下文，保存入站 Topic 与回复 Topic 等路由信息
 */
export interface MqttSessionContext {
  /** MQTT Client ID */
  clientId: string;
  /** Agent ID */
  agentId: string;
  /** 最近一次入站 Topic */
  lastInboundTopic: string;
  /** 当前会话的回复 Topic（可覆盖默认规则） */
  replyTopic?: string;
  /** accountId */
  accountId: string;
  /** 最近更新时间（毫秒时间戳） */
  updatedAt?: number;
}

/**
 * Last Will 配置（设备断线通知）
 */
export interface MqttWillConfig {
  /** Topic */
  topic: string;
  /** 内容 */
  payload: string;
  /** QoS */
  qos: 0 | 1;
  /** Retain */
  retain: boolean;
}
