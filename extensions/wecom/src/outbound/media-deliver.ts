/**
 * 企微非图片媒体与错误 fallback（Agent DM + stream 状态）。
 */

import type { WecomWebhookTarget } from "../webhook/types.js";
import { getMonitorState } from "../webhook/gateway.js";
import { buildFallbackPrompt } from "./fallback-prompts.js";
import { sendBotFallbackPromptNow } from "../webhook/active-reply.js";
import { agentDmMedia } from "../webhook/agent-dm.js";

type StreamSlice = {
  userId?: string;
  chatType?: "group" | "direct";
  agentMediaKeys?: string[];
  fallbackMode?: string;
};

/**
 * 处理非图片媒体：Agent DM + 媒体 fallback prompt。
 */
export async function deliverNonImageMedia(params: {
  target: WecomWebhookTarget;
  streamId: string;
  current: StreamSlice;
  mPath: string;
  contentType?: string;
  filename: string;
}): Promise<void> {
  const { target, streamId, current, mPath, contentType, filename } = params;
  const agentOk = Boolean(target.account.agent?.configured);
  const alreadySent = (current.agentMediaKeys ?? []).includes(mPath);
  if (agentOk && !alreadySent && current.userId) {
    try {
      await agentDmMedia({
        target,
        userId: current.userId,
        mediaUrlOrPath: mPath,
        contentType,
        filename,
      });
      getMonitorState().streamStore.updateStream(streamId, (s) => {
        s.agentMediaKeys = Array.from(new Set([...(s.agentMediaKeys ?? []), mPath]));
      });
    } catch (err) {
      target.runtime.error?.(`[webhook] Agent DM 媒体发送失败: ${String(err)}`);
    }
  }
  if (!current.fallbackMode) {
    await pushStreamFallback(target, streamId, current, "media", filename);
  }
}

/**
 * 媒体加载失败时的 Agent DM 重试与 error fallback。
 */
export async function deliverMediaLoadError(params: {
  target: WecomWebhookTarget;
  streamId: string;
  current: StreamSlice;
  mPath: string;
  err: unknown;
}): Promise<void> {
  const { target, streamId, current, mPath, err } = params;
  target.runtime.error?.(`[webhook] 媒体处理失败: ${mPath}: ${String(err)}`);
  const agentOk = Boolean(target.account.agent?.configured);
  const filename = mPath.split("/").pop() || "attachment";
  if (agentOk && current.userId && !(current.agentMediaKeys ?? []).includes(mPath)) {
    try {
      await agentDmMedia({
        target,
        userId: current.userId,
        mediaUrlOrPath: mPath,
        filename,
      });
      getMonitorState().streamStore.updateStream(streamId, (s) => {
        s.agentMediaKeys = Array.from(new Set([...(s.agentMediaKeys ?? []), mPath]));
      });
    } catch (sendErr) {
      target.runtime.error?.(`[webhook] fallback(error) Agent DM failed: ${String(sendErr)}`);
    }
  }
  if (!current.fallbackMode) {
    await pushStreamFallback(target, streamId, current, "error", filename);
  }
}

async function pushStreamFallback(
  target: WecomWebhookTarget,
  streamId: string,
  current: StreamSlice,
  kind: "media" | "error",
  filename: string,
): Promise<void> {
  const prompt = buildFallbackPrompt({
    kind,
    agentConfigured: Boolean(target.account.agent?.configured),
    userId: current.userId,
    filename,
    chatType: current.chatType,
  });
  getMonitorState().streamStore.updateStream(streamId, (s) => {
    s.fallbackMode = kind;
    s.finished = true;
    s.content = prompt;
    s.fallbackPromptSentAt = s.fallbackPromptSentAt ?? Date.now();
  });
  try {
    await sendBotFallbackPromptNow({ streamId, text: prompt });
  } catch (pushErr) {
    target.runtime.error?.(`[webhook] fallback(${kind}) push failed: ${String(pushErr)}`);
  }
}
