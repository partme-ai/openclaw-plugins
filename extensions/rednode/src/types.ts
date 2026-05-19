/**
 * 小红书渠道插件类型
 * 配置与《小红书开放平台对接规格》channels.xhs 一致
 */

import type { IncomingMessage, ServerResponse } from "node:http";

/** 小红书渠道账号/单店铺配置（直连模式：持 app_id/app_secret） */
export interface XhsAccountConfig {
  app_id: string;
  app_secret?: string;
  callback_url?: string;
  shop_id?: string;
  seller_id?: string;
  webhook_secret?: string;
  /** 多租户底座模式：底座服务根地址，如 https://xxx/ddd4j-rednote */
  ddd4j_api_base?: string;
  /** 多租户底座模式：平台颁发的 API Key（与 appId 绑定） */
  ddd4j_api_key?: string;
}

/** 入站发布参数：供运行时将 Webhook 事件写入 Session / 驱动 Agent */
export interface PublishInboundParams {
  channel: string;
  sessionId: string;
  shopId: string;
  content: string;
}

/** 插件专用 Logger（可选，由宿主注入；与 ZeroClaw/OpenClaw 对齐） */
export interface PluginLogger {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
  debug?: (msg: string) => void;
}

/** 插件 API（与 OpenClaw 插件约定一致；可选字段见《自定义插件实现优化指南》） */
export interface PluginApi {
  runtime: {
    config: Record<string, unknown>;
    channel?: {
      publishInbound?: (params: PublishInboundParams) => void | Promise<void>;
    };
    /** 可选：plugins.entries.<pluginId>.config，由宿主注入 */
    pluginConfig?: Record<string, unknown>;
    /** 可选：带 [plugin:id] 前缀的 logger，由宿主注入 */
    logger?: PluginLogger;
  };
  registerChannel: (options: { plugin: ChannelDefinition }) => void;
  registerHttpRoute: (params: { path: string; handler: HttpHandler }) => void;
  registerTool?: (tool: ToolDefinition, opts?: { optional?: boolean }) => void;
  onReady?: (callback: () => Promise<void>) => void;
}

export type HttpHandler = (
  req: IncomingMessage,
  res: ServerResponse
) => Promise<void> | void;

/** 渠道定义（与 OpenClaw Channel 约定一致） */
export interface ChannelDefinition {
  id: string;
  meta: { id: string; label: string; blurb: string; aliases: string[] };
  capabilities: { chatTypes: Array<"direct" | "group"> };
  config: {
    listAccountIds: (cfg: Record<string, unknown>) => string[];
    resolveAccount: (
      cfg: Record<string, unknown>,
      accountId?: string
    ) => XhsAccountConfig;
  };
  outbound: {
    deliveryMode: "direct";
    sendText: (params: SendTextParams) => Promise<{ ok: boolean }>;
  };
}

export interface SendTextParams {
  text: string;
  to: string;
  account: XhsAccountConfig;
}

/** 工具定义（与 OpenClaw registerTool 约定一致） */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  execute?: (params: Record<string, unknown>) => Promise<unknown> | unknown;
}
