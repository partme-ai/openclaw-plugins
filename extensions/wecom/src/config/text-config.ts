/**
 * @module text-config
 *
 * WeCom 用户可见文案：平铺 *Text 字段与内部 resolved 键映射。
 *
 * **职责**：定义 `channels.wecom` 下可配置的 `*Text` 字段类型，
 * 以及内部 `ResolvedWecomTemplates` 键 → config 字段名的映射表，
 * 供 `resolveWecomTemplates` 合并默认值。
 *
 * **适用场景**：渠道初始化、账号级 scalar 覆盖前的文案解析。
 *
 * **上下游**：
 * - 上游：openclaw.json `channels.wecom.*Text`
 * - 下游：`templates.resolveWecomTemplates`
 *
 * **关键导出**：`WeComUserTextConfig`、`WECOM_TEXT_KEY_MAPPING`
 */

import type { ResolvedWecomTemplates } from "./templates.js";

/**
 * 平铺在 `channels.wecom` 下的用户文案字段（*Text 命名）。
 *
 * 与内部 `ResolvedWecomTemplates` 键一一对应，见 {@link WECOM_TEXT_KEY_MAPPING}。
 */
export type WeComUserTextConfig = {
  /** enter_chat / subscribe 欢迎语 */
  welcomeText?: string;
  /** Bot 流式首帧 replyStream 占位（协议层，见 resolveWecomStreamPlaceholderText） */
  streamPlaceholderText?: string;
  thinkingText?: string;
  receivedText?: string;
  toolStatusText?: string;
  readingText?: string;
  generatingText?: string;
  compactionText?: string;
  emptyReplyText?: string;
  finishFooterText?: string;
  cardSentText?: string;
  mediaSentText?: string;
  mediaParseFailedText?: string;
  mediaDeliveredText?: string;
  processedCompleteText?: string;
  timeoutText?: string;
  dispatchErrorText?: string;
  mediaErrorNoAccessText?: string;
  mediaErrorReasonText?: string;
  mediaErrorGenericText?: string;
  queuedText?: string;
  mergedQueuedText?: string;
  mergedDoneText?: string;
  sessionResetText?: string;
  sessionNewText?: string;
};

/**
 * 内部 ResolvedWecomTemplates 键 → 平铺 config 字段名。
 *
 * @example
 * ```ts
 * // templates.thinking ← cfg.thinkingText
 * WECOM_TEXT_KEY_MAPPING.thinking // "thinkingText"
 * ```
 */
export const WECOM_TEXT_KEY_MAPPING: {
  [K in keyof ResolvedWecomTemplates]: keyof WeComUserTextConfig;
} = {
  welcome: "welcomeText",
  thinking: "thinkingText",
  received: "receivedText",
  tool: "toolStatusText",
  reading: "readingText",
  generating: "generatingText",
  compaction: "compactionText",
  emptyReply: "emptyReplyText",
  finishFooter: "finishFooterText",
  cardSent: "cardSentText",
  mediaSent: "mediaSentText",
  mediaParseFailed: "mediaParseFailedText",
  mediaDelivered: "mediaDeliveredText",
  processedComplete: "processedCompleteText",
  timeout: "timeoutText",
  dispatchError: "dispatchErrorText",
  mediaErrorNoAccess: "mediaErrorNoAccessText",
  mediaErrorReason: "mediaErrorReasonText",
  mediaErrorGeneric: "mediaErrorGenericText",
  queued: "queuedText",
  mergedQueued: "mergedQueuedText",
  mergedDone: "mergedDoneText",
  sessionReset: "sessionResetText",
  sessionNew: "sessionNewText",
};
