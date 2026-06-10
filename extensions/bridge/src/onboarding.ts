/**
 * @fileoverview Bridge 插件的 onboarding 文案占位导出面。
 *
 * @description
 * Bridge 本身不实现独立的分步向导；本模块仅转发渠道元数据，供上层 setup 文档或
 * CLI 展示「支持的渠道列表」等非交互用途。
 *
 * @module onboarding
 */

/**
 * Bridge 无独立 onboarding 流程；导出渠道元数据供 setup 文档引用。
 */

/** @description 渠道全表与单条元数据查询，供文档/CLI 列举支持渠道。 */
export { ALL_CHANNELS, getChannelMeta } from "./bridge/channels.js";
