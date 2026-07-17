/**
 * Bridge 对外类型门面。真实定义按 channels、capabilities、normalize 和 message-bridge
 * 分层维护；调用方只从此入口导入，避免依赖内部目录布局。
 */
export type { ChannelMeta, ChannelContextPreset } from "./bridge/channels.js";
export type {
  ChannelCapabilities,
  SupportedFormat,
  MediaKind,
  MarkdownDialect,
  OverflowStrategy,
} from "./bridge/capabilities.js";
export type { NormalizedMessage, ChannelNormalizer } from "./bridge/normalize.js";
export type { UnifiedMessage, BridgeConfig, BridgeChannelConfig } from "./bridge/message-bridge.js";
