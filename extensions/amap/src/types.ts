/**
 * 高德渠道插件类型定义（Domain Types）
 *
 * **架构角色**：插件内各层（Channel、Inbound、Outbound、Tools、Setup）共享的类型契约，
 * 与《高德开放平台对接规格》中 `channels.amap` 配置结构保持一致。
 *
 * **关键依赖**：`node:http` — HTTP Handler 签名
 */

import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * 高德渠道账号配置。
 *
 * 对应 openclaw.json 中 `channels.amap` 或 `channels.amap.accounts.<id>`。
 */
export interface AmapAccountConfig {
  /** 高德 Web 服务 API Key（必填） */
  key: string;
  /** 可选签名密钥（部分 API 场景） */
  secret?: string;
  /** 平台回调 URL，用于 Webhook 注册 */
  callback_url?: string;
  /** 绑定的 POI ID，入站会话 peerId / shopId 默认值 */
  poi_id?: string;
}

/**
 * 入站发布参数：供运行时将 Webhook 事件写入 Session / 驱动 Agent。
 *
 * 当 Bridge reply-pipeline 不可用时，由 `runtime.channel.publishInbound` 回退路径使用。
 */
export interface PublishInboundParams {
  /** 渠道标识，如 `"amap"` */
  channel: string;
  /** 会话 ID，通常为 `{channel}:{shopId}` */
  sessionId: string;
  /** 门店 / POI 标识 */
  shopId: string;
  /** 解析后的入站文本内容 */
  content: string;
}

/** 插件级 Logger，字段均为可选以兼容不同宿主实现。 */
export interface PluginLogger {
  info?: (msg: string, ...args: unknown[]) => void;
  warn?: (msg: string, ...args: unknown[]) => void;
  error?: (msg: string, ...args: unknown[]) => void;
  debug?: (msg: string, ...args: unknown[]) => void;
}

/**
 * 插件 API（与 OpenClaw 插件宿主约定一致）。
 *
 * 由 Gateway 注入，用于注册 Channel、HTTP 路由、工具及访问 runtime。
 */
export interface PluginApi {
  runtime: {
    config: Record<string, unknown>;
    channel?: {
      /** 轻量入站回退：无 reply-pipeline 时直接发布消息 */
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

/** Gateway HTTP 路由处理器签名。 */
export type HttpHandler = (
  req: IncomingMessage,
  res: ServerResponse
) => Promise<void> | void;

/**
 * OpenClaw Channel 完整定义结构。
 *
 * 包含元数据、能力、配置解析、出站及可选 setup 向导。
 */
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
  /** OpenClaw CLI setup wizard（声明式 onboard 配置） */
  setupWizard?: unknown;
  /** OpenClaw setup adapter（写入 channels 配置） */
  setup?: unknown;
}

/** 出站文本消息参数。 */
export interface SendTextParams {
  text: string;
  /** 目标标识（如 POI / 用户 ID） */
  to: string;
  account: AmapAccountConfig;
}

/**
 * Agent 工具定义。
 *
 * 由 `registerTool` 注册，供 LLM function calling 调用。
 */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema 风格参数描述 */
  parameters?: Record<string, unknown>;
  execute?: (params: Record<string, unknown>) => Promise<unknown> | unknown;
}
