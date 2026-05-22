/**
 * Webhook response_url 主动推送（企微 Bot 官方 JSON 协议）。
 */

import { wecomFetch } from "./http.js";
import { getMonitorState } from "./gateway.js";
import {
  buildStreamReplyFromState,
  truncateUtf8Bytes,
} from "./helpers.js";
import { STREAM_MAX_BYTES, REQUEST_TIMEOUT_MS } from "./types.js";

/** 获取 stream 绑定的 response_url */
export function getActiveReplyUrl(streamId: string): string | undefined {
  return getMonitorState().activeReplyStore.getUrl(streamId);
}

/** 一次性消费 response_url 发送请求 */
export async function useActiveReplyOnce(
  streamId: string,
  fn: (params: { responseUrl: string; proxyUrl?: string }) => Promise<void>,
): Promise<void> {
  return getMonitorState().activeReplyStore.use(streamId, fn);
}

/**
 * 通过 response_url 推送 Bot 兜底提示（流式 finish 帧）。
 */
export async function sendBotFallbackPromptNow(params: {
  streamId: string;
  text: string;
}): Promise<void> {
  const responseUrl = getActiveReplyUrl(params.streamId);
  if (!responseUrl) {
    throw new Error("no response_url（无法主动推送群内提示）");
  }
  await useActiveReplyOnce(params.streamId, async ({ responseUrl, proxyUrl }) => {
    const payload = {
      msgtype: "stream",
      stream: {
        id: params.streamId,
        finish: true,
        content: truncateUtf8Bytes(params.text, STREAM_MAX_BYTES) || "1",
      },
    };
    const res = await wecomFetch(
      responseUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      { proxyUrl, timeoutMs: REQUEST_TIMEOUT_MS },
    );
    if (!res.ok) {
      throw new Error(`fallback prompt push failed: ${res.status}`);
    }
  });
}

/** 推送最终流式回复帧 */
export async function pushFinalStreamReplyNow(streamId: string): Promise<void> {
  const state = getMonitorState().streamStore.getStream(streamId);
  const responseUrl = getActiveReplyUrl(streamId);
  if (!state || !responseUrl) return;
  const finalReply = buildStreamReplyFromState(state, STREAM_MAX_BYTES) as unknown as Record<
    string,
    unknown
  >;
  await useActiveReplyOnce(streamId, async ({ responseUrl, proxyUrl }) => {
    const res = await wecomFetch(
      responseUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalReply),
      },
      { proxyUrl, timeoutMs: REQUEST_TIMEOUT_MS },
    );
    if (!res.ok) {
      throw new Error(`final stream push failed: ${res.status}`);
    }
  });
}
