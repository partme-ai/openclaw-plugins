/**
 * OpenClaw 插件与渠道定义类型
 * PluginApi、ChannelDefinition、GatewayRuntime 等
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { WecomAccountConfig } from "./config.js";
import type {
  AgentRouteParams,
  AgentRouteResult,
  InboundContextParams,
  InboundContext,
  ReplyDispatcherParams,
  ReplyDispatcher,
  DispatchReplyParams,
  SendTextParams,
} from "./message.js";

/**
 * Gateway 运行时
 * 由 OpenClaw 注入，供 Agent 管线与配置读取使用
 */
export interface GatewayRuntime {
  config: Record<string, unknown>;
  channel: {
    routing: {
      resolveAgentRoute(params: AgentRouteParams): AgentRouteResult | Promise<AgentRouteResult>;
    };
    reply: {
      finalizeInboundContext(params: InboundContextParams): InboundContext | Promise<InboundContext>;
      createReplyDispatcherWithTyping(params: ReplyDispatcherParams): ReplyDispatcher;
      dispatchReplyFromConfig(params: DispatchReplyParams): unknown | Promise<unknown>;
    };
  };
}

/**
 * Agent 基础信息。
 */
export interface AgentInfo {
  id: string;
  workspace: string;
  [key: string]: unknown;
}

/**
 * ICS 运营统计概览。
 */
export interface StatsOverview {
  todaySessions: number;
  todayMessages: number;
  transferRate: number;
  activeAgents: number;
  generatedAt: string;
}

/**
 * OpenClaw 插件 API 接口
 */
export interface PluginApi {
  /** Gateway 运行时实例 */
  runtime: GatewayRuntime;
  /** 注册消息渠道 */
  registerChannel(options: { plugin: ChannelDefinition }): void;
  /** 注册 HTTP 路由端点 */
  registerHttpRoute(route: HttpRouteDefinition): void;
  /** 插件就绪回调 */
  onReady(callback: () => Promise<void>): void;
  /** 注册聊天命令（自动回复命令） */
  registerCommand(command: CommandDefinition): void;
}

/**
 * 聊天命令定义
 */
export interface CommandDefinition {
  name: string;
  description: string;
  handler: (ctx: CommandContext) => CommandResult | Promise<CommandResult>;
}

/**
 * 命令上下文
 */
export interface CommandContext {
  agentId: string;
  args: string;
  session?: Record<string, unknown>;
}

/**
 * 命令返回结果
 */
export interface CommandResult {
  text: string;
}

/**
 * HTTP 路由定义
 */
export interface HttpRouteDefinition {
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
}

/**
 * 渠道定义对象
 */
export interface ChannelDefinition {
  id: string;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities;
  config: ChannelConfig;
  outbound: ChannelOutbound;
}

/**
 * 渠道元信息
 */
export interface ChannelMeta {
  id: string;
  label: string;
  selectionLabel: string;
  docsPath: string;
  blurb: string;
  aliases: string[];
  order?: number;
  recommendedConfig?: Record<string, unknown>;
}

/**
 * 渠道能力声明
 */
export interface ChannelCapabilities {
  chatTypes: Array<"direct" | "group">;
}

/**
 * 渠道配置解析
 */
export interface ChannelConfig {
  listAccountIds: (cfg: Record<string, unknown>) => string[];
  resolveAccount: (cfg: Record<string, unknown>, accountId?: string) => WecomAccountConfig;
}

/**
 * 出站消息处理
 */
export interface ChannelOutbound {
  deliveryMode: "direct";
  sendText: (params: SendTextParams) => Promise<{ ok: boolean }>;
}
