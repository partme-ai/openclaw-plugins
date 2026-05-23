/**
 * @module outbound/bot-window
 *
 * 企微 Bot **被动回复窗口** 超时检测与 fallback 切换。
 *
 * 接近 BOT_WINDOW_MS 时停止 stream 增量，切换为 Agent DM / 文案 fallback。
 */

import type { WecomWebhookTarget } from "../webhook/types.js";
import {
  BOT_SWITCH_MARGIN_MS,
  BOT_WINDOW_MS,
} from "../webhook/types.js";
import { buildFallbackPrompt } from "./fallback-prompts.js";
import { isAgentConfigured } from "../webhook/inbound-helpers.js";
import { sendBotFallbackPromptNow } from "../webhook/active-reply.js";

export type BotWindowStreamSlice = {
  createdAt: number;
  fallbackMode?: string;
  finished?: boolean;
  userId?: string;
  chatType?: "group" | "direct";
};

export type BotWindowCheckParams = {
  target: WecomWebhookTarget;
  streamId: string;
  current: BotWindowStreamSlice;
  streamStore: {
    updateStream: (
      id: string,
      fn: (s: {
        fallbackMode?: string;
        finished?: boolean;
        content?: string;
        fallbackPromptSentAt?: number;
      }) => void,
    ) => void;
  };
  now?: number;
};

/**
 * 接近 Bot 窗口截止时触发 timeout fallback；返回 true 表示已处理并应终止 deliver。
 */
export async function handleBotWindowNearTimeout(
  params: BotWindowCheckParams,
): Promise<boolean> {
  const now = params.now ?? Date.now();
  const deadline = params.current.createdAt + BOT_WINDOW_MS;
  const switchAt = deadline - BOT_SWITCH_MARGIN_MS;
  const nearTimeout =
    !params.current.fallbackMode && !params.current.finished && now >= switchAt;
  if (!nearTimeout) {
    return false;
  }

  const agentOk = isAgentConfigured(params.target);
  const prompt = buildFallbackPrompt({
    kind: "timeout",
    agentConfigured: agentOk,
    userId: params.current.userId,
    chatType: params.current.chatType,
  });
  params.streamStore.updateStream(params.streamId, (s) => {
    s.fallbackMode = "timeout";
    s.finished = true;
    s.content = prompt;
    s.fallbackPromptSentAt = s.fallbackPromptSentAt ?? Date.now();
  });
  try {
    await sendBotFallbackPromptNow({ streamId: params.streamId, text: prompt });
  } catch (err) {
    params.target.runtime.error?.(`[webhook] fallback(timeout) push failed: ${String(err)}`);
  }
  return true;
}
