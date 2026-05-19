/**
 * 美团渠道插件类型
 * 配置与《美团开放平台对接规格》channels.meituan 一致
 */

import type { IncomingMessage, ServerResponse } from "node:http";

/** 美团渠道账号/单店铺配置 */
export interface MeituanAccountConfig {
  app_key: string;
  app_secret: string;
  callback_url?: string;
  shop_id?: string;
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

/** 插件 API（与 OpenClaw 插件约定一致；可选字段见《自定义插件实现优化指南》） */
export interface PluginApi {
  runtime: {
    config: Record<string, unknown>;
    /** 可选：入站写入 Session / 触发 Agent 管线；由运行时注入 */
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
    ) => MeituanAccountConfig;
  };
  outbound: {
    deliveryMode: "direct";
    sendText: (params: SendTextParams) => Promise<{ ok: boolean }>;
  };
}

export interface SendTextParams {
  text: string;
  to: string;
  account: MeituanAccountConfig;
}

/** 工具定义（与 OpenClaw registerTool 约定一致） */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  execute?: (params: Record<string, unknown>) => Promise<unknown> | unknown;
}
