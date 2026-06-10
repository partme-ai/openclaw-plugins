/**
 * @fileoverview Rednode 插件的类型聚合（账户、PluginApi、Channel 契约）。
 *
 * @description
 * 与《小红书开放平台对接规格》channels.xhs 字段对齐；集中导出供 inbound、
 * dispatch、channel 等模块引用，避免循环依赖。
 *
 * @module types
 */

/**
 * Rednode 共享类型 — Base Profile 入口。
 */

import type { IncomingMessage, ServerResponse } from "node:http";

/** @description 小红书渠道账号/单店铺配置（直连或多租户底座模式）。 */
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

/** @description 入站发布参数：供运行时将 Webhook 事件写入 Session / 驱动 Agent。 */
export interface PublishInboundParams {
  channel: string;
  sessionId: string;
  shopId: string;
  content: string;
}

/** @description 插件专用 Logger（可选，由宿主注入）。 */
export interface PluginLogger {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
  debug?: (msg: string) => void;
}

/** @description 插件 API（与 OpenClaw 插件约定一致）。 */
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

/** @description Gateway HTTP 路由处理器签名。 */
export type HttpHandler = (
  req: IncomingMessage,
  res: ServerResponse
) => Promise<void> | void;

/** @description 渠道定义（与 OpenClaw Channel 约定一致）。 */
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
  setupWizard?: unknown;
  setup?: unknown;
}

/** @description 出站 sendText 参数。 */
export interface SendTextParams {
  text: string;
  to: string;
  account: XhsAccountConfig;
}

/** @description 工具定义（与 OpenClaw registerTool 约定一致）。 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  execute?: (params: Record<string, unknown>) => Promise<unknown> | unknown;
}
