/**
 * Web STOMP 生产配置与协议类型。
 *
 * 将外部可配置的安全边界（认证、TLS、Origin、容量）和运行时 STOMP 会话结构集中定义，
 * 避免 transport、channel 与状态接口各自维护不一致的隐式对象形状。
 */

export type StompAckMode = "auto" | "client" | "client-individual";

export interface StompAuthUser {
  /** STOMP CONNECT login，必须在用户列表中唯一。 */
  login: string;
  /** 明文密码；仅建议本地开发使用。 */
  password?: string;
  /** 保存密码的环境变量名，生产环境优先使用。 */
  passwordEnv?: string;
  /** 十六进制 SHA-256/SHA-512 密码摘要。 */
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
  /** WebSocket 监听端口与路径。 */
  wsPort: number;
  path: string;
  host: string;
  /** 服务端期望接收和发送的 STOMP 心跳间隔。 */
  heartbeatIncoming: number;
  heartbeatOutgoing: number;
  /** 连接、帧、缓冲、订阅、队列、ACK 与速率硬上限。 */
  maxConnections: number;
  maxFrameSize: number;
  maxBufferedBytes: number;
  maxSubscriptionsPerConnection: number;
  maxPendingMessages: number;
  maxPendingAcks: number;
  messagesPerMinute: number;
  connectTimeoutMs: number;
  allowedOrigins: string[];
  /** 是否允许跨连接共享 Topic；默认关闭以隔离会话回复。 */
  allowSharedTopics: boolean;
  /** 默认 Agent 与允许客户端显式选择的 Agent 白名单。 */
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
  /** 每次 WebSocket 连接生成的新 ID，不跨重连复用。 */
  connectionId: string;
  login?: string;
  connectedAt: string;
  lastActiveAt: string;
  subscriptionCount: number;
  agentId?: string;
  peerId?: string;
  stompConnected: boolean;
  /** 仅用于诊断的对端地址，不参与代理信任或授权判断。 */
  remoteAddress?: string;
}

export interface ResolvedWebStompAccount {
  accountId: string;
  name: string;
  enabled: boolean;
  configured: boolean;
}
