/**
 * Bridge 共享类型 — Base Profile 入口。
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
export type { UnifiedMessage } from "./bridge/message-bridge.js";
export type { BridgeChannelConfig, BridgePluginConfig } from "./config.js";
