/**
 * 美团渠道插件类型定义。
 *
 * **架构角色**：描述 `channels.meituan` 配置、Channel 契约、Plugin API 与工具形态，
 * 与《美团开放平台对接规格》对齐。
 */

import type { IncomingMessage, ServerResponse } from "node:http";

/** 美团渠道账号/单店铺配置（openclaw.json → channels.meituan） */
export interface MeituanAccountConfig {
  /** 开放平台应用 key */
  app_key: string;
  /** 开放平台应用 secret，用于 OpenAPI 签名与 Webhook 验签 */
  app_secret: string;
  /** 开放平台配置的回调 URL（文档字段，运行时可选） */
  callback_url?: string;
  /** 门店 id，Webhook 无 shop_id 时的 peer 回退 */
  shop_id?: string;
  /** Webhook 专用签名密钥；缺省时使用 app_secret */
  webhook_secret?: string;
}

/** 入站发布参数：供运行时将 Webhook 事件写入 Session / 驱动 Agent */
export interface PublishInboundParams {
  channel: string;
  sessionId: string;
  shopId: string;
  content: string;
}

/** 插件级 Logger（借鉴 zeroclaw/openclaw，可选注入，便于与主工程日志统一） */
export interface PluginLogger {
  info?: (msg: string, ...args: unknown[]) => void;
  warn?: (msg: string, ...args: unknown[]) => void;
  error?: (msg: string, ...args: unknown[]) => void;
  debug?: (msg: string, ...args: unknown[]) => void;
}

/** 插件 API（与 OpenClaw 宿主约定一致） */
export interface PluginApi {
  runtime: {
    /** 宿主加载的全局配置（含 channels） */
    config: Record<string, unknown>;
    /** 可选：轻量入站写入 Session；bridge 不可用时的回退路径 */
    channel?: {
      publishInbound?: (params: PublishInboundParams) => void | Promise<void>;
    };
  };
  /** `plugins.entries.<pluginId>.config` 覆盖层 */
  pluginConfig?: Record<string, unknown>;
  /** 带 `[plugin:id]` 前缀的 logger */
  logger?: PluginLogger;
  registerChannel: (options: { plugin: ChannelDefinition }) => void;
  registerHttpRoute: (params: { path: string; handler: HttpHandler }) => void;
  registerTool?: (tool: ToolDefinition, opts?: { optional?: boolean }) => void;
  onReady?: (callback: () => Promise<void>) => void;
}

/** HTTP 路由 handler 签名 */
export type HttpHandler = (
  req: IncomingMessage,
  res: ServerResponse
) => Promise<void> | void;

/** 渠道定义（与 OpenClaw Channel 注册契约一致） */
export interface ChannelDefinition {
  id: string;
  meta: { id: string; label: string; blurb: string; aliases: string[] };
  capabilities: { chatTypes: Array<"direct" | "group"> };
  config: {
    listAccountIds: (cfg: Record<string, unknown>) => string[];
    resolveAccount: (
      cfg: Record<string, unknown>,
      accountId?: string
    ) => MeituanAccountConfig;
  };
  outbound: {
    deliveryMode: "direct";
    sendText: (params: SendTextParams) => Promise<{ ok: boolean }>;
  };
  setupWizard?: unknown;
  setup?: unknown;
}

/** 出站 sendText 参数 */
export interface SendTextParams {
  /** 待发送文本 */
  text: string;
  /** 目标 peer（如 shopId / userId） */
  to: string;
  /** 当前账号配置 */
  account: MeituanAccountConfig;
}

/** 工具定义（与 OpenClaw registerTool 约定一致） */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  execute?: (params: Record<string, unknown>) => Promise<unknown> | unknown;
}
