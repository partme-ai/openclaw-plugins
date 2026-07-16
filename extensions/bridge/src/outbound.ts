/**
 * @fileoverview Bridge 插件的跨渠道出站文本规范化公共出口。
 *
 * 导出的规范化器负责 Markdown 方言转换、转义和长度分片；本文件作为稳定 facade，隔离
 * 调用方与 `bridge/normalize.ts` 的内部组织方式。
 */
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
