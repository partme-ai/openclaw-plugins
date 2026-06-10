/**
 * @module transcript/finish-stream
 *
 * Transcript 流式关流兜底文案（保证非空，避免 thinking 假死）。
 *
 * **职责**：根据 {@link StreamFinishState} 快照，在 finish=true 时决定发送给用户的
 * 最终纯文本；优先 accumulatedText，其次卡片/媒体/错误摘要，最后 emptyReply。
 *
 * **适用场景**：stream session 关流、超时兜底、媒体-only 回复。
 *
 * **上下游**：
 * - 上游：dispatch / media 管线填充的 finish state
 * - 下游：IM 平台 stream finish API / 主动回复 HTTP
 *
 * **关键导出**：`resolveStreamFinishText`、`ResolveStreamFinishTextOptions`
 */

import {
  buildStreamBubbleText,
  type ResolvedChannelStreamingConfig,
} from "./streaming-config.js";
import type { StreamFinishState, StreamFinishTemplates } from "./stream-state-types.js";
import { formatElapsedFooter, formatTemplate } from "./templates.js";

/** resolveStreamFinishText 选项 */
export type ResolveStreamFinishTextOptions = {
  /** 流式配置（决定是否附加耗时脚注） */
  streamingConfig?: ResolvedChannelStreamingConfig;
  /** 关流模板集（含 mediaParseFailed） */
  templates: StreamFinishTemplates & { mediaParseFailed: string };
  /** 关流时间戳，默认 Date.now() */
  finishedAt?: number;
  /** 自定义 mediaParseFailed 格式化（可选） */
  formatMediaParseFailed?: (emptyReply: string) => string;
};

/**
 * 根据消息处理状态决定 finish=true 时发送给用户的文本。
 *
 * 决策优先级（自上而下）：
 * 1. accumulatedText（有正文）
 * 2. hasTemplateCard → cardSent
 * 3. hasMedia → mediaSent 或 mediaErrorSummary
 * 4. mediaErrorSummary / dispatchErrorSummary
 * 5. inboundHadMedia → mediaParseFailed
 * 6. emptyReply
 *
 * 若 footerElapsed 开启且 replyStartedAt 存在，附加耗时脚注。
 *
 * @param state - 关流状态快照
 * @param options - 模板与流式配置
 * @returns 非空用户可见关流文案
 */
export function resolveStreamFinishText(
  state: StreamFinishState,
  options: ResolveStreamFinishTextOptions,
): string {
  const templates = options.templates;
  const visibleText = state.accumulatedText?.trim();
  let answerText: string;

  if (visibleText) {
    answerText = state.accumulatedText!;
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
    answerText = options.formatMediaParseFailed
      ? options.formatMediaParseFailed(templates.emptyReply)
      : formatTemplate(templates.mediaParseFailed, { emptyReply: templates.emptyReply });
  } else {
    // 兜底：避免 finish 空包导致客户端 thinking 假死
    answerText = templates.emptyReply;
  }

  const cfg = options.streamingConfig;
  if (cfg?.footerElapsed && state.replyStartedAt != null) {
    const finishedAt = options.finishedAt ?? Date.now();
    const footerLine = formatElapsedFooter(
      finishedAt - state.replyStartedAt,
      templates.finishFooter,
    );
    const composed = buildStreamBubbleText({
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
