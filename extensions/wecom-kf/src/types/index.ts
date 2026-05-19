/**
 * 企微客服插件类型统一导出
 * 与 wecom 插件 types/index 结构对齐
 */

export type {
  WecomAccountConfig,
  KfAccount,
  ServicerInfo,
  EventMessagesConfig,
  AccountMapping,
} from "./config.js";

export type {
  KfEvent,
  KfMessage,
  SyncMsgResponse,
  AgentRouteParams,
  AgentRouteResult,
  InboundContextParams,
  InboundContext,
  ReplyDispatcherParams,
  ReplyDispatcher,
  DispatchReplyParams,
  SendTextParams,
} from "./message.js";

export type {
  GatewayRuntime,
  PluginApi,
  CommandDefinition,
  CommandContext,
  CommandResult,
  HttpRouteDefinition,
  ChannelDefinition,
  ChannelMeta,
  ChannelCapabilities,
  ChannelConfig,
  ChannelOutbound,
} from "./channel.js";
