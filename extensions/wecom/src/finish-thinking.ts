/**
 * 解析 thinking 流关闭时的最终展示文案。
 *
 * 企微会忽略纯空白内容，必须用可见字符替换 thinking 动画，否则用户侧会一直「假死」。
 */

import { EMPTY_REPLY_FALLBACK_MESSAGE } from "./const.js";
import type { MessageState } from "./interface.js";

/**
 * 根据消息处理状态决定 finish=true 时发送给用户的文本。
 * 保证返回值非空，避免 thinking 流无法被关闭。
 */
export function resolveThinkingFinishText(state: MessageState): string {
  const visibleText = state.accumulatedText?.trim();
  if (visibleText) {
    return state.accumulatedText;
  }

  if (state.hasTemplateCard) {
    return "📋 卡片消息已发送。";
  }

  if (state.hasMedia) {
    if (state.hasMediaFailed && state.mediaErrorSummary) {
      return state.mediaErrorSummary;
    }
    return "📎 文件已发送，请查收。";
  }

  if (state.mediaErrorSummary) {
    return state.mediaErrorSummary;
  }

  if (state.dispatchErrorSummary) {
    return state.dispatchErrorSummary;
  }

  if (state.inboundHadMedia) {
    return `⚠️ 未能解析该媒体并生成回复。${EMPTY_REPLY_FALLBACK_MESSAGE}`;
  }

  return EMPTY_REPLY_FALLBACK_MESSAGE;
}

/**
 * 构建 Agent 回复超时时的用户可见摘要。
 */
export function buildAgentReplyTimeoutSummary(timeoutMs: number): string {
  const minutes = Math.max(1, Math.round(timeoutMs / 60_000));
  return `⚠️ 处理超时（约 ${minutes} 分钟），请稍后重试或发送文字消息。`;
}

/**
 * 构建 dispatch onError 时的用户可见摘要（截断过长错误）。
 */
export function buildDispatchErrorSummary(kind: string, err: unknown, maxLen = 200): string {
  const raw = String(err).replace(/\s+/g, " ").trim();
  const detail = raw.length > maxLen ? `${raw.slice(0, maxLen)}…` : raw;
  return `⚠️ 回复生成失败（${kind}）：${detail || "未知错误"}`;
}
