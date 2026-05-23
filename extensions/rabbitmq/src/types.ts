/**
 * openclaw-rabbitmq 核心类型定义（RabbitMQ 协议与载荷）。
 */

// ─────────────────── RabbitMQ 配置类型 ───────────────────

/** 入站 payload 解析模式 */
export type RabbitmqPayloadParseMode = "jsonTextOrPlain";

/**
 * RabbitMQ Payload 解析配置
 */
export interface RabbitmqPayloadConfig {
  /** 解析模式，当前支持 JSON.text 优先后回退纯文本 */
  mode: RabbitmqPayloadParseMode;
  /** 出站 reply 信封格式（wire dispatch） */
  outboundFormat?: "envelope" | "legacyJsonText" | "plainText";
}

/**
 * Topic 与 Agent 的显式绑定配置
 */
export interface RabbitmqTopicBinding {
  /** Topic 匹配模式（支持 * 和 # 通配符） */
  topicPattern: string;
  /** 绑定的 Agent ID */
  agentId: string;
  /** 可选的 OpenClaw accountId */
  accountId?: string;
  /** 可选的固定回复 Topic */
  replyTopic?: string;
}

/**
 * RabbitMQ Channel 配置（channels.rabbitmq）
 */
export interface RabbitmqChannelConfig {
  /** RabbitMQ 服务地址 */
  url: string;
  /** 连接超时时间（毫秒） */
  connectionTimeout?: number;
  /** 心跳间隔（秒） */
  heartbeat?: number;
  /** Exchange 名称 */
  exchange: string;
  /** Exchange 类型 */
  exchangeType: "direct" | "topic" | "fanout" | "headers";
  /** 是否持久化 Exchange */
  exchangeDurable?: boolean;
  /** 队列前缀 */
  queuePrefix?: string;
  /** 指定允许接收的多 Topic 订阅模式 */
  subscribeTopics: string[];
  /** 显式 Topic 绑定规则 */
  topicBindings: RabbitmqTopicBinding[];
  /** Payload 解析策略 */
  payload: RabbitmqPayloadConfig;
}

/**
 * OpenClaw 全局 DM 会话粒度（source: session.dmScope）
 */
export type OpenClawDmScope =
  | "main"
  | "per-peer"
  | "per-channel-peer"
  | "per-account-channel-peer";

// ─────────────────── RabbitMQ 客户端与会话类型 ───────────────────

/**
 * RabbitMQ Peer 信息
 * 追踪每个连接设备的状态
 */
export interface RabbitmqPeerInfo {
  /** RabbitMQ Peer ID */
  peerId: string;
  /** 连接时间 */
  connectedAt: string;
  /** 最后活跃时间 */
  lastActiveAt: string;
  /** 关联的 Agent ID（从订阅 topic 推断） */
  agentId?: string;
  /** 关联的 OpenClaw 会话键 */
  sessionKey?: string;
}

/**
 * RabbitMQ Topic 到 Agent 的映射规则
 */
export interface RabbitmqTopicMapping {
  /** Topic 匹配模式（支持 * 和 # 通配符） */
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
export interface RabbitmqInboundRoute {
  /** 命中的 Agent ID */
  agentId: string;
  /** accountId（默认 default） */
  accountId: string;
  /** 优先回复 Topic（可为空） */
  replyTopic?: string;
  /** 命中模式，便于日志与诊断 */
  matchedPattern?: string;
  /** 命中来源 */
  source: "binding" | "standard";
  /** Peer ID */
  peerId: string;
}

/**
 * RabbitMQ 入站消息（设备 -> Agent）
 */
export interface RabbitmqInboundMessage {
  /** 来源 Routing Key */
  routingKey: string;
  /** 消息内容 */
  content: string;
  /** 时间戳 */
  timestamp: string;
}

/**
 * RabbitMQ 出站消息（Agent -> 设备）
 */
export interface RabbitmqOutboundMessage {
  /** 目标 Routing Key */
  routingKey: string;
  /** 消息内容 */
  content: string;
}

/**
 * 会话上下文，保存入站 Topic 与回复 Topic 等路由信息
 */
export interface RabbitmqSessionContext {
  /** RabbitMQ Peer ID */
  peerId: string;
  /** Agent ID */
  agentId: string;
  /** accountId */
  accountId: string;
  /** 最近一次入站 Topic */
  lastInboundTopic?: string;
  /** 当前会话的回复 Topic（可覆盖默认规则） */
  replyTopic?: string;
  /** 最近更新时间（毫秒时间戳） */
  updatedAt: number;
}

/**
 * RabbitMQ 通用消息格式
 */
export interface RabbitmqMessage {
  agentId: string;
  peerId: string;
  content: string;
  timestamp: string;
}