/**
 * openclaw_wechat_ipad 核心类型定义
 *
 * 包含：
 * - OpenClaw Plugin API 接口（与 Gateway 交互）
 * - iPad 协议服务的消息与事件结构
 * - 会话映射与插件配置
 */

import type { IncomingMessage, ServerResponse } from "node:http";

// ─────────────────── OpenClaw Plugin API 类型 ───────────────────

/**
 * OpenClaw 插件 API 接口
 * 由 Gateway 在插件加载时注入
 */
export interface PluginApi {
  /** Gateway 运行时实例 */
  runtime: GatewayRuntime;
  /** 注册渠道 */
  registerChannel(channel: ChannelRegistration): void;
  /** 注册 HTTP 路由端点 */
  registerHttpRoute(route: HttpRouteDefinition): void;
}

/** 渠道注册包装 */
export interface ChannelRegistration {
  plugin: ChannelDefinition;
}

/** 渠道元数据（UI 展示与排序） */
export interface ChannelMeta {
  id: string;
  label: string;
  selectionLabel: string;
  docsPath: string;
  blurb: string;
  aliases?: string[];
  order?: number;
}

/** 渠道定义（OpenClaw Channel 契约） */
export interface ChannelDefinition {
  id: string;
  name: string;
  meta: ChannelMeta;
  capabilities: { chatTypes: ("direct" | "group" | "channel" | "thread")[] };
  config: {
    listAccountIds: (cfg: Record<string, unknown>) => string[];
    resolveAccount: (cfg: Record<string, unknown>, accountId?: string | null) => Record<string, unknown>;
  };
  outbound: {
    sendText: (sessionKey: string, text: string) => Promise<void>;
  };
}

/** HTTP 路由定义 */
export interface HttpRouteDefinition {
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
}

/** Gateway 运行时（消息管道入口） */
export interface GatewayRuntime {
  config: Record<string, unknown>;
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

// ─────────────────── iPad 协议服务类型 ───────────────────

/**
 * iPad 协议服务连接状态
 */
export type BridgeState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "logged_in"
  | "logged_out";

/**
 * 微信登录状态
 */
export type WxLoginStatus =
  | "waiting_scan"    // 等待扫码
  | "scanned"         // 已扫码，等待确认
  | "confirmed"       // 已确认登录
  | "logged_in"       // 登录成功
  | "logged_out"      // 已退出
  | "token_expired";  // Token 过期

/**
 * 微信消息类型（协议服务推送的原始类型码）
 */
export enum WxMsgType {
  /** 文本消息 */
  Text = 1,
  /** 图片消息 */
  Image = 3,
  /** 语音消息 */
  Voice = 34,
  /** 名片 */
  Card = 42,
  /** 视频消息 */
  Video = 43,
  /** 表情消息 */
  Emoji = 47,
  /** 位置消息 */
  Location = 48,
  /** 链接/文章 */
  Link = 49,
  /** 小程序 */
  MiniApp = 33,
  /** 系统消息 */
  System = 10000,
  /** 系统消息（撤回等） */
  SystemExtend = 10002,
}

/**
 * iPad 协议服务事件类型（WebSocket 推送）
 */
export enum IpadEventType {
  /** 收到新消息 */
  Message = "message",
  /** 登录状态变更 */
  LoginStatus = "login_status",
  /** 联系人变更 */
  ContactUpdate = "contact_update",
  /** 群成员变更 */
  GroupMemberUpdate = "group_member_update",
  /** 好友请求 */
  FriendRequest = "friend_request",
  /** 二维码推送（扫码登录） */
  QrCode = "qr_code",
  /** 心跳 */
  Heartbeat = "heartbeat",
  /** 连接就绪 */
  Ready = "ready",
  /** 错误 */
  Error = "error",
}

/**
 * iPad 协议服务推送的事件基础结构
 */
export interface IpadEvent<T = unknown> {
  /** 事件类型 */
  type: IpadEventType;
  /** 事件负载 */
  data: T;
  /** 事件时间戳（毫秒） */
  timestamp: number;
}

/**
 * 微信消息事件负载
 */
export interface WxMessagePayload {
  /** 消息 ID */
  msgId: string;
  /** 发送者 wxid */
  fromWxid: string;
  /** 发送者昵称 */
  fromNickname?: string;
  /** 接收者 wxid（个人聊天为自己，群聊为群 wxid） */
  toWxid: string;
  /** 群消息时，实际发言人的 wxid */
  groupSenderWxid?: string;
  /** 消息类型码 */
  msgType: WxMsgType;
  /** 文本内容（文本消息时有值） */
  content?: string;
  /** 原始 XML（富媒体消息的完整数据） */
  rawXml?: string;
  /** 消息时间戳（秒） */
  createTime: number;
  /** 是否群消息 */
  isGroup: boolean;
  /** 是否自己发送的 */
  isSelf: boolean;
}

/**
 * 登录状态变更负载
 */
export interface WxLoginPayload {
  /** 当前登录状态 */
  status: WxLoginStatus;
  /** 登录的微信号 wxid */
  wxid?: string;
  /** 昵称 */
  nickname?: string;
  /** 头像 URL */
  avatarUrl?: string;
  /** 二维码 Base64（等待扫码时） */
  qrCodeBase64?: string;
  /** 过期时间（秒） */
  expireSeconds?: number;
}

/**
 * 好友请求负载
 */
export interface WxFriendRequestPayload {
  /** 请求者 wxid */
  fromWxid: string;
  /** 请求者昵称 */
  nickname: string;
  /** 验证消息 */
  verifyContent: string;
  /** 来源场景（搜索、群聊等） */
  scene: number;
  /** 原始 ticket（自动通过时需要） */
  ticket: string;
}

// ─────────────────── 出站 API 类型 ───────────────────

/**
 * 向 iPad 协议服务发送消息的请求
 */
export interface SendMessageRequest {
  /** 接收者 wxid（个人或群） */
  toWxid: string;
  /** 消息类型（目前支持 text） */
  msgType: "text" | "image" | "file" | "link";
  /** 文本内容 */
  content?: string;
  /** 媒体 URL（图片/文件时使用） */
  mediaUrl?: string;
  /** 链接消息附加信息 */
  link?: {
    title: string;
    desc: string;
    url: string;
    thumbUrl?: string;
  };
}

/**
 * iPad 协议服务 HTTP API 响应通用结构
 */
export interface IpadApiResponse<T = unknown> {
  /** 是否成功 */
  ok: boolean;
  /** 错误消息 */
  error?: string;
  /** 响应数据 */
  data?: T;
}

// ─────────────────── 插件配置类型 ───────────────────

/**
 * 插件配置（从 openclaw.plugin.json configSchema 映射）
 */
export interface WechatIpadConfig {
  /** iPad 协议服务 WebSocket 地址 */
  serviceUrl: string;
  /** iPad 协议服务 HTTP API 地址 */
  apiUrl: string;
  /** 重连配置 */
  reconnect: {
    enabled: boolean;
    intervalMs: number;
    maxRetries: number;
  };
  /** 认证配置 */
  auth: {
    token?: string;
  };
  /** 消息处理配置 */
  message: {
    handleGroup: boolean;
    groupWhitelist: string[];
    ignoreself: boolean;
  };
}

/** 默认插件配置 */
export const DEFAULT_CONFIG: WechatIpadConfig = {
  serviceUrl: "ws://127.0.0.1:5555",
  apiUrl: "http://127.0.0.1:5556",
  reconnect: {
    enabled: true,
    intervalMs: 5000,
    maxRetries: 30,
  },
  auth: {},
  message: {
    handleGroup: false,
    groupWhitelist: [],
    ignoreself: true,
  },
};
