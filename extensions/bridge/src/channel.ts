/**
 * Bridge 渠道注册表 — Base Profile 入口。
 */

export {
  ALL_CHANNELS,
  getChannelMeta,
  getExternalChannels,
  getBundledChannels,
  getChannelCapabilities,
} from "./bridge/channels.js";
export type { ChannelMeta, ChannelContextPreset } from "./bridge/channels.js";
