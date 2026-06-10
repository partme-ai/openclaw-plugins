/**
 * @fileoverview openclaw-stomp 核心类型：STOMP 帧、连接、入站消息与配置。
 *
 * @description
 * 集中导出 transport / inbound / config 共用的类型符号；无运行时逻辑。
 *
 * @module types
 */

/**
 * STOMP 共享类型 — Base Profile 入口。
 */

/** @description STOMP 订阅 ACK 模式。 */
export type StompAckMode = "auto" | "client" | "client-individual";

/**
 * @description Topic 模式与 Agent 的显式绑定。
 */
export interface TopicBinding {
  topicPattern: string;
  agentId: string;
  accountId?: string;
  replyTopic?: string;
}

/**
 * @description STOMP TCP 服务器完整配置。
 */
export interface StompTcpConfig {
  port: number;
  tlsPort: number;
  tls: {
    enabled: boolean;
    certFile?: string;
    keyFile?: string;
    caFile?: string;
  };
  heartbeat: {
    serverMs: number;
    clientMs: number;
  };
  maxConnections: number;
  maxFrameSize: number;
  auth: {
    required: boolean;
    defaultUser?: string;
    defaultPass?: string;
  };
  subscribeTopics: string[];
  topicBindings: TopicBinding[];
  defaultAckMode: StompAckMode;
  prefetchCount: number;
}

/** @description 解析后的 STOMP 协议帧。 */
export interface StompFrame {
  command: string;
  headers: Record<string, string>;
  body: string;
}

/** @description 对外暴露的连接摘要（诊断 API）。 */
export interface StompConnection {
  id: string;
  remoteAddress: string;
  remotePort: number;
  version: string;
  user?: string;
  connectedAt: string;
  subscriptions: string[];
  inflightCount: number;
  queuedCount: number;
}

/** @description 路由解析后的 STOMP 入站消息（尚未 wire 解析）。 */
export interface InboundMessage {
  agentId: string;
  accountId: string;
  peerId: string;
  destination: string;
  replyDestination?: string;
  /** STOMP SEND 帧原始 body（由 inbound 经 normalizeWireIngress 解析）。 */
  rawPayload: string;
  /** 可选幂等键（message-id / receipt / 合成键）。 */
  idempotencyKey?: string;
}

/** @description transport 层入站回调类型。 */
export type InboundHandler = (message: InboundMessage) => void;

/** @description 路由/连接运行时统计快照。 */
export interface StompStatusSnapshot {
  totalConnections: number;
  totalSubscriptions: number;
  routedInbound: number;
  routedOutbound: number;
  droppedInbound: number;
  ackPending: number;
}
