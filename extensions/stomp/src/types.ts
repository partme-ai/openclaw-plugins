/**
 * openclaw-stomp 核心类型定义。
 */

export type StompAckMode = "auto" | "client" | "client-individual";

/**
 * Topic 与 agent 的显式绑定。
 */
export interface TopicBinding {
  topicPattern: string;
  agentId: string;
  accountId?: string;
  replyTopic?: string;
}

/**
 * STOMP 服务器配置。
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

export interface StompFrame {
  command: string;
  headers: Record<string, string>;
  body: string;
}

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

export type InboundHandler = (message: InboundMessage) => void;

export interface StompStatusSnapshot {
  totalConnections: number;
  totalSubscriptions: number;
  routedInbound: number;
  routedOutbound: number;
  droppedInbound: number;
  ackPending: number;
}
