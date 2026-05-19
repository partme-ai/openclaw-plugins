/**
 * 高德渠道插件类型
 * 配置与《高德开放平台对接规格》channels.amap 一致
 */

import type { IncomingMessage, ServerResponse } from "node:http";

/** 高德渠道账号配置 */
export interface AmapAccountConfig {
  key: string;
  secret?: string;
  callback_url?: string;
  poi_id?: string;
}

/** 入站发布参数：供运行时将 Webhook 事件写入 Session / 驱动 Agent */
export interface PublishInboundParams {
  channel: string;
  sessionId: string;
  shopId: string;
  content: string;
}

/** 插件级 Logger */
export interface PluginLogger {
  info?: (msg: string, ...args: unknown[]) => void;
  warn?: (msg: string, ...args: unknown[]) => void;
  error?: (msg: string, ...args: unknown[]) => void;
  debug?: (msg: string, ...args: unknown[]) => void;
}

/** 插件 API（与 OpenClaw 插件约定一致） */
export interface PluginApi {
  runtime: {
    config: Record<string, unknown>;
    channel?: {
      publishInbound?: (params: PublishInboundParams) => void | Promise<void>;
    };
    pluginConfig?: Record<string, unknown>;
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

/** 渠道定义 */
export interface ChannelDefinition {
  id: string;
  meta: { id: string; label: string; blurb: string; aliases: string[] };
  capabilities: { chatTypes: Array<"direct" | "group"> };
  config: {
    listAccountIds: (cfg: Record<string, unknown>) => string[];
    resolveAccount: (
      cfg: Record<string, unknown>,
      accountId?: string
    ) => AmapAccountConfig;
  };
  outbound: {
    deliveryMode: "direct";
    sendText: (params: SendTextParams) => Promise<{ ok: boolean }>;
  };
}

export interface SendTextParams {
  text: string;
  to: string;
  account: AmapAccountConfig;
}

/** 工具定义 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  execute?: (params: Record<string, unknown>) => Promise<unknown> | unknown;
}
