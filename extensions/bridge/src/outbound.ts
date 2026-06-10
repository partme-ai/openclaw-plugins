/**
 * @fileoverview Bridge 出站消息规范化能力的门面导出。
 *
 * @description
 * 对应插件架构中的「出站适配」边界：把通用 Agent 文本转换为各 IM 渠道可接受的
 * 格式与分段策略。实现细节位于 `bridge/normalize.ts`，本文件仅为 Base Profile 固定路径入口。
 *
 * @module outbound
 */

/**
 * Bridge 出站规范化 — Base Profile 入口。
 */

/** @description 按渠道能力矩阵做 Markdown 转义、剥离与智能分段。 */
export {
  normalizeForChannel,
  getChannelNormalizer,
  stripMarkdown,
  escapeMarkdownV2,
  convertToMrkdwn,
  splitText,
  stripAdvancedMarkdown,
} from "./bridge/normalize.js";
export type { NormalizedMessage, ChannelNormalizer } from "./bridge/normalize.js";
