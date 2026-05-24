/**
 * Bridge 出站规范化 — Base Profile 入口。
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
