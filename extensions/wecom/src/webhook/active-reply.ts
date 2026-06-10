/**
 * @module webhook/active-reply
 *
 * Webhook **response_url** 主动推送（企微 Bot 官方 JSON 协议）。
 *
 * **职责**：
 * - 绑定 streamId ↔ response_url（读/write 经 ActiveReplyStore）
 * - 推送兜底提示、最终 stream finish 帧
 *
 * **与 message-sdk 关系**：`ActiveReplyStore`（ingress 子模块）管理 URL 生命周期。
 *
 * **关键导出**：`getActiveReplyUrl`、`useActiveReplyOnce`、
 * `sendBotFallbackPromptNow`、`pushFinalStreamReplyNow`
 */

import { wecomFetch } from "./http.js";
import { getMonitorState } from "./gateway.js";
import {
  buildStreamReplyFromState,
  truncateUtf8Bytes,
} from "./inbound-helpers.js";
import { STREAM_MAX_BYTES, REQUEST_TIMEOUT_MS } from "./types.js";

/**
 * 获取 stream 绑定的 response_url。
 *
 * @param streamId - stream ID
 * @returns response_url；未存储时 undefined
 */
export function getActiveReplyUrl(streamId: string): string | undefined {
  return getMonitorState().activeReplyStore.getUrl(streamId);
}

/**
 * 一次性消费 response_url 执行回调（policy 由 ActiveReplyStore 控制）。
 *
 * @param streamId - stream ID
 * @param fn - 接收 responseUrl + proxyUrl 的发送逻辑
 * @returns Promise
 */
export async function useActiveReplyOnce(
  streamId: string,
  fn: (params: { responseUrl: string; proxyUrl?: string }) => Promise<void>,
): Promise<void> {
  return getMonitorState().activeReplyStore.use(streamId, fn);
}

/**
 * 通过 response_url 推送 Bot 兜底提示（流式 finish 帧）。
 *
 * WHY：群聊/超时/媒体兜底需在 Bot 原会话可见，不能仅依赖 stream_refresh 轮询。
 *
 * @param params.streamId - stream ID
 * @param params.text - 兜底中文提示
 * @returns Promise
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

/**
 * 推送最终流式回复帧（含 images/msg_item）。
 *
 * @param streamId - stream ID
 * @returns Promise（无 response_url 时静默返回）
 */
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
