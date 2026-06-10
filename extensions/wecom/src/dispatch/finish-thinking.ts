/**
 * @module finish-thinking
 *
 * 解析 thinking 流关闭（finish=true）时的最终展示文案（委托 message-sdk transcript）。
 *
 * **职责**：综合 dispatch 错误摘要、空回复、媒体解析失败等 state 标志，
 * 在关流前产出应发送给用户的最终气泡文本。
 *
 * **适用场景**：WS / Webhook reply pipeline 在 `finalize*` 阶段调用。
 *
 * **上下游**：
 * - 上游：`MessageState`（accumulatedText / dispatchErrorSummary 等）
 * - 下游：`message-sender.sendWeComReply(finish=true)`
 *
 * **关键导出**：`resolveThinkingFinishText`
 */

import { resolveStreamFinishText } from "@partme.ai/openclaw-message-sdk/transcript";
import type { MessageState } from "../types/interface.js";
import {
  type ResolvedWecomStreamingConfig,
} from "../config/streaming-config.js";
import {
  formatWecomTemplate,
  WECOM_DEFAULT_TEMPLATES,
  type ResolvedWecomTemplates,
} from "../config/templates.js";
import type { StreamState } from "../webhook/types.js";

/** `resolveThinkingFinishText` 可选参数 */
export type ResolveThinkingFinishTextOptions = {
  streamingConfig?: ResolvedWecomStreamingConfig;
  templates?: ResolvedWecomTemplates;
  /** 关流时刻（默认 Date.now()） */
  finishedAt?: number;
};

/**
 * 根据消息处理状态决定 finish=true 时发送给用户的文本。
 *
 * **优先级**（由 message-sdk `resolveStreamFinishText` 实现）：
 * dispatch 错误摘要 → 空回复兜底 → 媒体解析失败 → 已累积正文 + 脚注
 *
 * @param state - 流式消息状态
 * @param options.streamingConfig - 流式配置（控制脚注等）
 * @param options.templates - 文案模板
 * @param options.finishedAt - 关流时刻
 * @returns 最终 replyStream 文本
 */
export function resolveThinkingFinishText(
  state: MessageState,
  options?: ResolveThinkingFinishTextOptions,
): string {
  const templates = options?.templates ?? WECOM_DEFAULT_TEMPLATES;
  return resolveStreamFinishText(state, {
    streamingConfig: options?.streamingConfig,
    templates,
    finishedAt: options?.finishedAt,
    formatMediaParseFailed: (emptyReply) =>
      formatWecomTemplate(templates.mediaParseFailed, { emptyReply }),
  });
}

export {
  buildAgentReplyTimeoutSummary,
  buildDispatchErrorSummary,
} from "../config/templates.js";

/** Webhook StreamState 关流时可传入 resolveThinkingFinishText 的字段 */
export type WebhookStreamFinishInput = Pick<
  StreamState,
  "answerText" | "dispatchErrorSummary" | "replyStartedAt" | "content" | "statusLine"
> &
  Partial<
    Pick<
      MessageState,
      | "hasMedia"
      | "hasMediaFailed"
      | "mediaErrorSummary"
      | "hasTemplateCard"
      | "inboundHadMedia"
    >
  >;

/**
 * Webhook 关流前写入最终 content：failed/空回复兜底仅在 finish 阶段使用，不在 typing 中间态刷屏。
 *
 * @param state - StreamStore 中的流状态（会被原地更新 content / answerText / statusLine）
 * @param streamingConfig - 流式配置
 * @param templates - 文案模板
 * @param options.finishedAt - 关流时刻
 */
export function applyWecomWebhookStreamFinishContent(
  state: WebhookStreamFinishInput,
  streamingConfig: ResolvedWecomStreamingConfig,
  templates: ResolvedWecomTemplates = WECOM_DEFAULT_TEMPLATES,
  options?: { finishedAt?: number },
): void {
  const hasVisibleAnswer = Boolean(state.answerText?.trim());
  if (hasVisibleAnswer && !state.dispatchErrorSummary) {
    return;
  }

  const finishText = resolveThinkingFinishText(
    {
      accumulatedText: state.answerText ?? "",
      dispatchErrorSummary: state.dispatchErrorSummary,
      replyStartedAt: state.replyStartedAt,
      hasMedia: state.hasMedia,
      hasMediaFailed: state.hasMediaFailed,
      mediaErrorSummary: state.mediaErrorSummary,
      hasTemplateCard: state.hasTemplateCard,
      inboundHadMedia: state.inboundHadMedia,
    },
    {
      streamingConfig,
      templates,
      finishedAt: options?.finishedAt ?? Date.now(),
    },
  );

  state.answerText = finishText;
  state.statusLine = undefined;
  state.content = finishText;
}
