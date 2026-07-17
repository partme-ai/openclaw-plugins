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
  /** 浏览器 Origin 白名单；非浏览器客户端通常不发送 Origin */
  allowedOrigins: string[];
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
  /** 单客户端等待或正在执行的 Agent 入站任务上限。 */
  maxPendingMessagesPerClient: number;
  /** 单次 Agent 入站任务硬超时。 */
  inboundTaskTimeoutMs: number;
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
  /**
   * CONNECT 认证成功时绑定到物理连接的用户名快照。
   *
   * 不能在异步 Agent 任务执行时仅凭 clientId 反查用户名：MQTT 允许同名 clientId
   * 的新连接接管旧连接，届时反查会把旧消息错误归属给新用户。
   */
  authenticatedUsername?: string;
  /** MQTT packet messageId（QoS>0 时可用，用于幂等） */
  messageId?: string;
}

/** 会话上下文 */
export interface SessionContext {
  sessionKey: string;
  clientId: string;
  /** 产生该会话消息的认证身份快照，供异步回复执行 outbound ACL。 */
  authenticatedUsername?: string;
  agentId: string;
  accountId: string;
  lastInboundTopic: string;
  replyTopic?: string;
}

/** 服务统计信息 */
export interface WebMqttServiceStats {
  connectedClients: number;
  /** WebSocket Upgrade 或 MQTT CONNECT 阶段拒绝的连接数。 */
  rejectedConnections: number;
  /** MQTT 身份认证失败次数。 */
  authFailures: number;
  /** publish / subscribe ACL 拒绝次数。 */
  aclDenials: number;
  acceptedMessages: number;
  droppedMessages: number;
  routedByBinding: number;
  routedByStandard: number;
  outboundMessages: number;
  /** 当前排队等待的入站 Agent 任务数。 */
  inboundQueued: number;
  /** 当前至少有一个任务在运行的 clientId 数量。 */
  inboundActive: number;
  lastError?: string;
  brokerReady: boolean;
}

/** 入站消息回调（可 async；transport 层通过 per-client 串行队列调度） */
export type InboundHandlerResult = { accepted: boolean; reason?: string } | void;
/**
 * Web MQTT transport 向 OpenClaw 消息管道提交入站事件的回调。
 *
 * 同一 clientId 的调用由 transport 串行化；返回 `accepted: false` 表示消息被业务层拒绝，
 * `void` 保留给兼容旧处理器的成功语义，抛错则由队列边界记录并计入丢弃统计。
 */
export type InboundHandler = (event: InboundEvent) => InboundHandlerResult | Promise<InboundHandlerResult>;
