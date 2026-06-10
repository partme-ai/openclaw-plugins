/**
 * openclaw-web-mqtt 类型定义。
 * 该文件聚合配置模型、路由模型与运行时统计模型，供入口、服务层与测试复用。
 */

/** 入站 payload 解析模式 */
export type PayloadMode = "jsonTextOrPlain";

/** TLS 配置 */
export interface WebMqttTlsConfig {
  enabled: boolean;
  keyFile?: string;
  certFile?: string;
  caFile?: string;
  minVersion?: "TLSv1.2" | "TLSv1.3";
  requestCert?: boolean;
  rejectUnauthorized?: boolean;
}

/** WebSocket 服务参数 */
export interface WebMqttWsOptions {
  compress: boolean;
  idleTimeoutMs: number;
  maxFrameSize: number;
}

/** 鉴权用户 */
export interface WebMqttUser {
  username: string;
  password?: string;
  passwordHash?: string;
  hashAlgorithm?: "sha256" | "sha512";
  publishAllow?: string[];
  subscribeAllow?: string[];
  aclRules?: WebMqttAclRule[];
}

/** 细粒度 ACL 规则 */
export interface WebMqttAclRule {
  action: "publish" | "subscribe" | "inbound" | "outbound";
  topicPattern: string;
  effect: "allow" | "deny";
  accountId?: string;
}

/** 鉴权配置 */
export interface WebMqttAuthConfig {
  required: boolean;
  allowAnonymous: boolean;
  users: WebMqttUser[];
}

/** 流控与资源限制 */
export interface WebMqttLimitsConfig {
  maxPayloadBytes: number;
  maxSubscriptionsPerClient: number;
}

/** 显式 topic 绑定 */
export interface WebMqttTopicBinding {
  topicPattern: string;
  agentId: string;
  accountId?: string;
  replyTopic?: string;
}

/** 渠道配置 */
export interface WebMqttConfig {
  port: number;
  path: string;
  host: string;
  maxConnections: number;
  topicPrefix: string;
  subscribeTopics: string[];
  topicBindings: WebMqttTopicBinding[];
  payload: {
    mode: PayloadMode;
    outboundFormat?: "envelope" | "legacyJsonText" | "plainText";
  };
  auth: WebMqttAuthConfig;
  tls: WebMqttTlsConfig;
  ws: WebMqttWsOptions;
  limits: WebMqttLimitsConfig;
  proxyProtocol: boolean;
}

/** 入站路由结果 */
export interface InboundRoute {
  agentId: string;
  accountId: string;
  replyTopic?: string;
  matchedPattern: string;
  source: "binding" | "standard";
}

/** 入站事件 */
export interface InboundEvent {
  topic: string;
  payload: Buffer;
  clientId: string;
  /** MQTT packet messageId（QoS>0 时可用，用于幂等） */
  messageId?: string;
}

/** 会话上下文 */
export interface SessionContext {
  sessionKey: string;
  clientId: string;
  agentId: string;
  accountId: string;
  lastInboundTopic: string;
  replyTopic?: string;
}

/** 服务统计信息 */
export interface WebMqttServiceStats {
  connectedClients: number;
  acceptedMessages: number;
  droppedMessages: number;
  routedByBinding: number;
  routedByStandard: number;
  outboundMessages: number;
  lastError?: string;
  brokerReady: boolean;
}

/** 入站消息回调（可 async；transport 层通过 per-client 串行队列调度） */
export type InboundHandler = (event: InboundEvent) => void | Promise<void>;
