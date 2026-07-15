/** Shared production types for the embedded STOMP 1.2 TCP channel. */
export type StompAckMode = "auto" | "client" | "client-individual";

export interface TopicBinding {
  topicPattern: string;
  agentId: string;
  accountId?: string;
  replyTopic?: string;
}

export interface StompAuthUser {
  login: string;
  password?: string;
  passwordEnv?: string;
  passwordHash?: string;
  hashAlgorithm?: "sha256" | "sha512";
}

export interface StompTcpConfig {
  host: string;
  port: number;
  tlsPort: number;
  tls: {
    enabled: boolean;
    host: string;
    certFile?: string;
    keyFile?: string;
    caFile?: string;
    minVersion: "TLSv1.2" | "TLSv1.3";
    requestCert: boolean;
    rejectUnauthorized: boolean;
  };
  heartbeat: { serverMs: number; clientMs: number };
  maxConnections: number;
  maxFrameSize: number;
  maxBufferedBytes: number;
  maxSubscriptionsPerConnection: number;
  maxQueueDepthPerSubscription: number;
  maxPendingMessages: number;
  messagesPerMinute: number;
  connectTimeoutMs: number;
  maxDurableSubscriptions: number;
  auth: { required: boolean; users: StompAuthUser[] };
  subscribeTopics: string[];
  topicBindings: TopicBinding[];
  defaultAgentId: string;
  allowedAgentIds: string[];
  allowSharedTopics: boolean;
  allowDurableSubscriptions: boolean;
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
  secure: boolean;
  connected: boolean;
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
  rawPayload: string;
  idempotencyKey?: string;
}

export type InboundHandler = (message: InboundMessage) => Promise<void> | void;

export interface StompStatusSnapshot {
  running: boolean;
  totalConnections: number;
  totalSubscriptions: number;
  durableSubscriptions: number;
  routedInbound: number;
  routedOutbound: number;
  droppedInbound: number;
  droppedOutbound: number;
  ackPending: number;
}

export interface ResolvedStompTcpAccount {
  accountId: string;
  name: string;
  enabled: boolean;
  configured: boolean;
}
