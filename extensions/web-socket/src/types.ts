/**
 * @module web-socket/types
 *
 * WebSocket Channel 类型定义。
 */

/** 运行模式：客户端连外部 / 内置服务端 / 二者并存 */
export type WebsocketMode = "client" | "server" | "both";

/** OpenClaw 全局 session.dmScope（与 MQTT 插件对齐）。 */
export type OpenClawDmScope =
  | "main"
  | "per-peer"
  | "per-channel-peer"
  | "per-account-channel-peer";

/** 连接 → Agent 绑定 */
export type WebsocketAgentBinding = {
  connectionId?: string;
  connectionIdPrefix?: string;
  agentId: string;
  accountId?: string;
};

/** 内置 WebSocket 服务端配置 */
export type WebsocketServerConfig = {
  wsPort: number;
  path: string;
  host: string;
  maxConnections: number;
  auth: {
    enabled: boolean;
    token?: string;
    tokens: string[];
    /** 兼容旧浏览器客户端；会把凭据暴露给 URL 日志，默认关闭。 */
    allowQueryToken: boolean;
  };
  allowedOrigins: string[];
  /** 显式接受远程明文 ws；生产环境应优先由反向代理终止 TLS。 */
  allowInsecureRemote: boolean;
};

/** WebSocket 客户端（连外部 WS）配置 */
export type WebsocketClientConfig = {
  url?: string;
  protocols: string[];
  headers: Record<string, string>;
  token?: string;
  clientId: string;
  connectTimeoutMs: number;
  /** 显式接受连接远程明文 ws。 */
  allowInsecureRemote: boolean;
  reconnect: {
    enabled: boolean;
    initialDelayMs: number;
    maxDelayMs: number;
  };
};

/** channels.web-socket 配置 */
export type WebsocketChannelConfig = {
  mode: WebsocketMode;
  server: WebsocketServerConfig;
  client: WebsocketClientConfig;
  defaultAgentId?: string;
  /** 是否信任入站帧声明 agentId；默认由服务端配置决定路由。 */
  allowFrameAgentId: boolean;
  agentBindings: WebsocketAgentBinding[];
  payload: {
    mode: "jsonTextOrPlain";
    outboundFormat: "envelope" | "plain";
  };
  limits: {
    maxPayloadBytes: number;
    maxBufferedBytes: number;
    maxPendingMessages: number;
    messagesPerMinute: number;
    heartbeatIntervalMs: number;
    heartbeatTimeoutMs: number;
  };
  session: {
    maxExpirySeconds: number;
    persistentAcrossReconnect: boolean;
  };
};

/** 入站路由结果 */
export type WebsocketInboundRoute = {
  agentId: string;
  accountId: string;
  source: "binding" | "frame" | "default";
};

/** 入站 WebSocket 消息上下文 */
export type WebsocketInboundMessage = {
  connectionId: string;
  rawPayload: string;
  frameAgentId?: string;
  messageId?: string;
  /** 外部 WS 协议中的对端 id（客户端模式多 peer 复用单连接时使用） */
  peerId?: string;
};

/** 会话上下文（出站回复定位连接） */
export type WebsocketSessionContext = {
  connectionId: string;
  agentId: string;
  accountId: string;
  updatedAt?: number;
};

/** 连接元信息（状态 API） */
export type WebsocketConnectionInfo = {
  connectionId: string;
  connectedAt: string;
  lastActiveAt: string;
  remoteAddress?: string;
};
