/**
 * @module text-stages
 *
 * WeCom 用户可见文案的阶段分类（welcome / typing / failed / finalSuccess / protocol）。
 *
 * **职责**：为配置键与内部模板键标注使用阶段，供文档、测试与运行时校验引用。
 *
 * **阶段语义**：
 * - `welcome`：进入会话/订阅欢迎，非流式 typing 状态
 * - `protocol`：Bot 流式协议首帧占位（`finish=false`，非状态栏）
 * - `typing`：`finish=false` 期间的状态栏/占位，宜短、可频繁更新
 * - `failed`：最终失败/空回复/超时/媒体错误等兜底（仅 `finish=true` 或等价关流）
 * - `finalSuccess`：成功关流时的最终提示（非 typing、非 failed）
 *
 * **关键导出**：`WECOM_TEXT_STAGES`、`isWecomTypingConfigKey`、`isWecomFailedConfigKey`
 */

import type { ResolvedWecomTemplates } from "./templates.js";
import type { WeComUserTextConfig } from "./text-config.js";

/** 文案使用阶段 */
export type WecomTextStage = "welcome" | "protocol" | "typing" | "failed" | "finalSuccess";

/** 平铺 config 键 → 阶段（`streamPlaceholderText` 为协议层，无内部模板键） */
export const WECOM_TEXT_STAGES: Record<keyof WeComUserTextConfig, WecomTextStage> = {
  welcomeText: "welcome",
  streamPlaceholderText: "protocol",
  thinkingText: "typing",
  receivedText: "typing",
  toolStatusText: "typing",
  readingText: "typing",
  generatingText: "typing",
  compactionText: "typing",
  queuedText: "typing",
  mergedQueuedText: "typing",
  emptyReplyText: "failed",
  timeoutText: "failed",
  dispatchErrorText: "failed",
  mediaErrorNoAccessText: "failed",
  mediaErrorReasonText: "failed",
  mediaErrorGenericText: "failed",
  mediaParseFailedText: "failed",
  finishFooterText: "finalSuccess",
  cardSentText: "finalSuccess",
  mediaSentText: "finalSuccess",
  mediaDeliveredText: "finalSuccess",
  processedCompleteText: "finalSuccess",
  mergedDoneText: "finalSuccess",
  sessionResetText: "finalSuccess",
  sessionNewText: "finalSuccess",
};

/** 内部 ResolvedWecomTemplates 键 → 阶段 */
export const WECOM_TEMPLATE_STAGES: Record<keyof ResolvedWecomTemplates, WecomTextStage> = {
  welcome: "welcome",
  thinking: "typing",
  received: "typing",
  tool: "typing",
  reading: "typing",
  generating: "typing",
  compaction: "typing",
  queued: "typing",
  mergedQueued: "typing",
  emptyReply: "failed",
  timeout: "failed",
  dispatchError: "failed",
  mediaErrorNoAccess: "failed",
  mediaErrorReason: "failed",
  mediaErrorGeneric: "failed",
  mediaParseFailed: "failed",
  finishFooter: "finalSuccess",
  cardSent: "finalSuccess",
  mediaSent: "finalSuccess",
  mediaDelivered: "finalSuccess",
  processedComplete: "finalSuccess",
  mergedDone: "finalSuccess",
  sessionReset: "finalSuccess",
  sessionNew: "finalSuccess",
};

/** typing 阶段建议的最大字符数（含 emoji），超出仍可配置但不推荐 */
export const WECOM_TYPING_TEXT_MAX_RECOMMENDED_LENGTH = 24;

/** 所有 typing 阶段的平铺 config 键 */
export const WECOM_TYPING_CONFIG_KEYS = (
  Object.entries(WECOM_TEXT_STAGES) as Array<[keyof WeComUserTextConfig, WecomTextStage]>
)
  .filter(([, stage]) => stage === "typing")
  .map(([key]) => key);

/** 所有 failed 阶段的平铺 config 键 */
export const WECOM_FAILED_CONFIG_KEYS = (
  Object.entries(WECOM_TEXT_STAGES) as Array<[keyof WeComUserTextConfig, WecomTextStage]>
)
  .filter(([, stage]) => stage === "failed")
  .map(([key]) => key);

/**
 * 判断平铺 config 键是否属于 typing 阶段。
 *
 * @param key - channels.wecom 下的 *Text 字段名
 */
export function isWecomTypingConfigKey(key: keyof WeComUserTextConfig): boolean {
  return WECOM_TEXT_STAGES[key] === "typing";
}

/**
 * 判断平铺 config 键是否属于 failed 阶段（最终兜底/错误，非中间状态）。
 *
 * @param key - channels.wecom 下的 *Text 字段名
 */
export function isWecomFailedConfigKey(key: keyof WeComUserTextConfig): boolean {
  return WECOM_TEXT_STAGES[key] === "failed";
}

/**
 * 判断内部模板键是否属于 typing 阶段。
 *
 * @param key - ResolvedWecomTemplates 键
 */
export function isWecomTypingTemplateKey(key: keyof ResolvedWecomTemplates): boolean {
  return WECOM_TEMPLATE_STAGES[key] === "typing";
}

/**
 * 判断内部模板键是否属于 failed 阶段。
 *
 * @param key - ResolvedWecomTemplates 键
 */
export function isWecomFailedTemplateKey(key: keyof ResolvedWecomTemplates): boolean {
  return WECOM_TEMPLATE_STAGES[key] === "failed";
}
