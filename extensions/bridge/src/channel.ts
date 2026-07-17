/**
 * @fileoverview Bridge 插件的渠道元数据公共出口。
 *
 * 这里只重导出渠道注册表、能力查询和上下文预设类型，真实数据源位于 `bridge/channels.ts`；
 * 使用统一出口可避免调用方依赖内部目录结构。
 */
export {
  ALL_CHANNELS,
  getChannelMeta,
  getExternalChannels,
  getBundledChannels,
  getChannelCapabilities,
} from "./bridge/channels.js";
export type { ChannelMeta, ChannelContextPreset } from "./bridge/channels.js";
