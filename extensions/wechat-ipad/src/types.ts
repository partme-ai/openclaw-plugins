/**
 * openclaw_wechat_ipad 核心类型定义
 *
 * 包含：
 * - OpenClaw Plugin API 接口（与 Gateway 交互）
 * - iPad 协议服务的消息与事件结构
 * - 会话映射与插件配置
 */

import type { OpenClawPluginApi, PluginRuntime } from "openclaw/plugin-sdk/core";

export type PluginApi = OpenClawPluginApi;
export type GatewayRuntime = PluginRuntime;

export type PluginLogger = Pick<OpenClawPluginApi["logger"], "debug" | "info" | "warn" | "error">;

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
  /** 默认关闭，避免未经授权自动连接外部协议服务。 */
  enabled: boolean;
  /** 必须显式确认使用非官方协议的账号与合规风险。 */
  acknowledgeUnofficialProtocolRisk: boolean;
  /** 初次连接失败时是否阻止 Gateway 启动。 */
  required: boolean;
  /** iPad 协议服务 WebSocket 地址 */
  serviceUrl: string;
  /** iPad 协议服务 HTTP API 地址 */
  apiUrl: string;
  /** 重连配置 */
  reconnect: {
    enabled: boolean;
    initialDelayMs: number;
    maxDelayMs: number;
    maxRetries: number;
    jitterRatio: number;
  };
  /** 认证配置 */
  auth: {
    token?: string;
  };
  network: {
    connectTimeoutMs: number;
    requestTimeoutMs: number;
    maxResponseBytes: number;
    maxEventBytes: number;
    heartbeatIntervalMs: number;
    pongTimeoutMs: number;
  };
  /** 消息处理配置 */
  message: {
    handleGroup: boolean;
    groupWhitelist: string[];
    allowAllGroups: boolean;
    ignoreSelf: boolean;
    maxTextChars: number;
  };
}

/** 默认插件配置 */
export const DEFAULT_CONFIG: WechatIpadConfig = {
  enabled: false,
  acknowledgeUnofficialProtocolRisk: false,
  required: true,
  serviceUrl: "ws://127.0.0.1:5555",
  apiUrl: "http://127.0.0.1:5556",
  reconnect: {
    enabled: true,
    initialDelayMs: 1000,
    maxDelayMs: 30_000,
    maxRetries: 30,
    jitterRatio: 0.2,
  },
  auth: {},
  network: {
    connectTimeoutMs: 10_000,
    requestTimeoutMs: 10_000,
    maxResponseBytes: 1024 * 1024,
    maxEventBytes: 1024 * 1024,
    heartbeatIntervalMs: 30_000,
    pongTimeoutMs: 10_000,
  },
  message: {
    handleGroup: false,
    groupWhitelist: [],
    allowAllGroups: false,
    ignoreSelf: true,
    maxTextChars: 20_000,
  },
};
