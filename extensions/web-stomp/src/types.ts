/** Production configuration and protocol types for STOMP 1.2 over WebSocket. */

export type StompAckMode = "auto" | "client" | "client-individual";

export interface StompAuthUser {
  login: string;
  password?: string;
  passwordEnv?: string;
  passwordHash?: string;
  hashAlgorithm?: "sha256" | "sha512";
}

export interface StompTlsConfig {
  enabled: boolean;
  keyFile?: string;
  certFile?: string;
  caFile?: string;
  minVersion: "TLSv1.2" | "TLSv1.3";
  requestCert: boolean;
  rejectUnauthorized: boolean;
}

export interface StompServerConfig {
  wsPort: number;
  path: string;
  host: string;
  heartbeatIncoming: number;
  heartbeatOutgoing: number;
  maxConnections: number;
  maxFrameSize: number;
  maxBufferedBytes: number;
  maxSubscriptionsPerConnection: number;
  maxPendingMessages: number;
  maxPendingAcks: number;
  messagesPerMinute: number;
  connectTimeoutMs: number;
  allowedOrigins: string[];
  allowSharedTopics: boolean;
  defaultAgentId: string;
  allowedAgentIds: string[];
  auth: {
    required: boolean;
    users: StompAuthUser[];
  };
  tls: StompTlsConfig;
}

export type StompCommand =
  | "CONNECT"
  | "STOMP"
  | "CONNECTED"
  | "SEND"
  | "SUBSCRIBE"
  | "UNSUBSCRIBE"
  | "BEGIN"
  | "COMMIT"
  | "ABORT"
  | "ACK"
  | "NACK"
  | "DISCONNECT"
  | "MESSAGE"
  | "RECEIPT"
  | "ERROR";

export interface StompFrame {
  command: StompCommand;
  headers: Record<string, string>;
  body?: string;
}

export interface StompSubscription {
  id: string;
  destination: string;
  ack: StompAckMode;
  connectionId: string;
}

export interface StompConnectionInfo {
  connectionId: string;
  login?: string;
  connectedAt: string;
  lastActiveAt: string;
  subscriptionCount: number;
  agentId?: string;
  peerId?: string;
  stompConnected: boolean;
  remoteAddress?: string;
}

export interface ResolvedWebStompAccount {
  accountId: string;
  name: string;
  enabled: boolean;
  configured: boolean;
}
