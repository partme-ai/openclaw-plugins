/**
 * @fileoverview Bridge 渠道目录与能力的组合导出面。
 *
 * @description
 * 将渠道元数据查询函数与「按渠道 ID 读取能力模型」一并导出，便于消费方单一入口获取
 * 「是谁」与「能干什么」两类信息；`getChannelCapabilities` 的实际定义在 `capabilities.ts`，经 `channels.ts` 再导出以保持兼容路径。
 *
 * @module channel
 */

/**
 * Bridge 渠道注册表 — Base Profile 入口。
 */

/** @description 全渠道列表与按 ID / 来源分类的查询函数，含 `getChannelCapabilities` 再导出。 */
export {
  ALL_CHANNELS,
  getChannelMeta,
  getExternalChannels,
  getBundledChannels,
  getChannelCapabilities,
} from "./bridge/channels.js";
export type { ChannelMeta, ChannelContextPreset } from "./bridge/channels.js";
