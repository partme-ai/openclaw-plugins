/**
 * openclaw-web-stomp 核心类型定义
 * STOMP over WebSocket 协议桥接层所需的数据结构
 */

import type { IncomingMessage, ServerResponse } from "node:http";

// ─────────────────── OpenClaw Plugin API 类型 ───────────────────

/**
 * OpenClaw 插件 API 接口
 */
export interface PluginApi {
  /** Gateway 运行时实例 */
  runtime: GatewayRuntime;

  /** 注册渠道（Channel） */
  registerChannel(channel: ChannelRegistration): void;

  /** 注册 HTTP 路由端点 */
  registerHttpRoute(route: HttpRouteDefinition): void;

}

/**
 * 渠道注册定义
 */
export interface ChannelRegistration {
  plugin: ChannelDefinition;
}

/**
 * 渠道元数据（OpenClaw ChannelMeta 子集，用于 UI 与排序）
 */
export interface ChannelMeta {
  id: string;
  label: string;
  selectionLabel: string;
  docsPath: string;
  blurb: string;
  aliases?: string[];
  order?: number;
}

/**
 * 渠道定义
 */
export interface ChannelDefinition {
  /** 渠道唯一标识 */
  id: string;
  /** 渠道名称 */
  name: string;
  /** 渠道元数据（必填，Gateway 排序与 UI 依赖 meta.order / meta.label） */
  meta: ChannelMeta;
  /** 渠道能力（必填，OpenClaw 构建 dock 时会读取，缺失会导致 nativeCommands 等访问报错） */
  capabilities: { chatTypes: ("direct" | "group" | "channel" | "thread")[] };
  /** 渠道配置（必填，Health 等会调用 config.listAccountIds / config.resolveAccount） */
  config: {
    listAccountIds: (cfg: Record<string, unknown>) => string[];
    resolveAccount: (cfg: Record<string, unknown>, accountId?: string | null) => Record<string, unknown>;
  };
  /** 出站消息方法 */
  outbound: {
    sendText: (sessionKey: string, text: string) => Promise<void>;
  };
}

/**
 * HTTP 路由定义
 */
export interface HttpRouteDefinition {
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
}

/**
 * Gateway 运行时
 */
export interface GatewayRuntime {
  /** 当前配置 */
  config: Record<string, unknown>;
  /** Channel 消息管道（由 Gateway 注入，用于 Agent 路由与消息分发） */
  channel: {
    routing: {
      resolveAgentRoute(params: {
        cfg: Record<string, unknown>;
        channel: string;
        accountId: string;
        peer: { kind: string; id: string };
      }): Promise<{ agentId: string; [key: string]: unknown }>;
    };
    reply: {
      finalizeInboundContext(params: {
        channel: string;
        accountId: string;
        from: string;
        text: string;
        chatType: string;
        extra?: Record<string, unknown>;
      }): Promise<Record<string, unknown>>;
      createReplyDispatcherWithTyping(params: {
        deliver: (payload: { text: string }) => Promise<void>;
      }): Record<string, unknown>;
      dispatchReplyFromConfig(params: {
        ctx: Record<string, unknown>;
        cfg: Record<string, unknown>;
        dispatcher: Record<string, unknown>;
        replyOptions: { agentId: string; [key: string]: unknown };
      }): Promise<void>;
    };
  };
}

// ─────────────────── STOMP 配置类型 ───────────────────

/**
 * STOMP 服务器配置
 */
export interface StompServerConfig {
  /** WebSocket 端口，默认 15674 */
  wsPort: number;
  /** WebSocket 路径，默认 "/ws" */
  path: string;
  /** 入站心跳间隔（毫秒），默认 10000 */
  heartbeatIncoming: number;
  /** 出站心跳间隔（毫秒），默认 10000 */
  heartbeatOutgoing: number;
  /** 最大连接数，默认 500 */
  maxConnections: number;
}

// ─────────────────── STOMP 帧类型 ───────────────────

/**
 * STOMP 帧命令枚举
 */
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

/**
 * STOMP 帧结构
 */
export interface StompFrame {
  /** 帧命令 */
  command: StompCommand;
  /** 帧头部 */
  headers: Record<string, string>;
  /** 帧体（可选） */
  body?: string;
}

// ─────────────────── 订阅管理类型 ───────────────────

/**
 * STOMP 订阅信息
 */
export interface StompSubscription {
  /** 订阅 ID（客户端指定） */
  id: string;
  /** 订阅的 Destination */
  destination: string;
  /** ACK 模式 */
  ack: "auto" | "client" | "client-individual";
  /** 关联的 WebSocket 连接 ID */
  connectionId: string;
}

/**
 * STOMP 连接信息
 */
export interface StompConnectionInfo {
  /** 连接 ID */
  connectionId: string;
  /** 客户端登录名 */
  login?: string;
  /** 连接时间 */
  connectedAt: string;
  /** 最后活跃时间 */
  lastActiveAt: string;
  /** 活跃订阅数 */
  subscriptionCount: number;
  /** 关联的 Agent ID */
  agentId?: string;
  /** 关联的 OpenClaw 会话键 */
  sessionKey?: string;
}
