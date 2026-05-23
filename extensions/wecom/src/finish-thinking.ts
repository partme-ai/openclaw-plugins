/**
 * 解析 thinking 流关闭时的最终展示文案。
 *
 * 企微会忽略纯空白内容，必须用可见字符替换 thinking 动画，否则用户侧会一直「假死」。
 */

import type { MessageState } from "./interface.js";
import {
  buildWecomStreamBubbleText,
  type ResolvedWecomStreamingConfig,
} from "./streaming-config.js";
import {
  formatWecomElapsedFooter,
  formatWecomTemplate,
  WECOM_DEFAULT_TEMPLATES,
  type ResolvedWecomTemplates,
} from "./templates.js";

export type ResolveThinkingFinishTextOptions = {
  streamingConfig?: ResolvedWecomStreamingConfig;
  templates?: ResolvedWecomTemplates;
  /** 关流时刻（默认 Date.now()） */
  finishedAt?: number;
};

/**
 * 根据消息处理状态决定 finish=true 时发送给用户的文本。
 * 保证返回值非空，避免 thinking 流无法被关闭。
 */
export function resolveThinkingFinishText(
  state: MessageState,
  options?: ResolveThinkingFinishTextOptions,
): string {
  const templates = options?.templates ?? WECOM_DEFAULT_TEMPLATES;
  const visibleText = state.accumulatedText?.trim();
  let answerText: string;
  if (visibleText) {
    answerText = state.accumulatedText;
  } else if (state.hasTemplateCard) {
    answerText = templates.cardSent;
  } else if (state.hasMedia) {
    if (state.hasMediaFailed && state.mediaErrorSummary) {
      answerText = state.mediaErrorSummary;
    } else {
      answerText = templates.mediaSent;
    }
  } else if (state.mediaErrorSummary) {
    answerText = state.mediaErrorSummary;
  } else if (state.dispatchErrorSummary) {
    answerText = state.dispatchErrorSummary;
  } else if (state.inboundHadMedia) {
    answerText = formatWecomTemplate(templates.mediaParseFailed, {
      emptyReply: templates.emptyReply,
    });
  } else {
    answerText = templates.emptyReply;
  }

  const cfg = options?.streamingConfig;
  if (cfg?.footerElapsed && state.replyStartedAt != null) {
    const finishedAt = options?.finishedAt ?? Date.now();
    const footerLine = formatWecomElapsedFooter(finishedAt - state.replyStartedAt, templates);
    const composed = buildWecomStreamBubbleText({
      answerText,
      footerLine,
      includeStatus: false,
      includeAnswer: true,
      includeFooter: true,
    });
    if (composed.trim()) {
      return composed;
    }
  }

  return answerText;
}

export {
  buildAgentReplyTimeoutSummary,
  buildDispatchErrorSummary,
} from "./templates.js";
