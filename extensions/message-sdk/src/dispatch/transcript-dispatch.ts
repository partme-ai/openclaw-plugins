/** 标准 channel.inbound 路径的已组装 Transcript 派发。 */

import type { TranscriptDispatchParams, TranscriptDispatchResult } from "./types.js";

/** 将一个已授权入站轮次交由宿主管理记录、Agent 执行与回复结算。 */
export async function dispatchTranscriptTurn(
  params: TranscriptDispatchParams,
): Promise<TranscriptDispatchResult> {
  const { channelRuntime, signal } = params;
  const dispatchReply = channelRuntime.inbound?.dispatchReply;
  const recordInboundSession = channelRuntime.session?.recordInboundSession;
  const bufferedReply = channelRuntime.reply?.dispatchReplyWithBufferedBlockDispatcher;
  if (!dispatchReply || !recordInboundSession || !bufferedReply || !params.storePath) {
    throw new Error("stable channel inbound transcript runtime is unavailable");
  }
  if (signal?.aborted) {
    throw new DOMException("transcript dispatch cancelled", "AbortError");
  }

  const result = await dispatchReply({
    cfg: params.cfg,
    channel: params.channel,
    accountId: params.accountId,
    agentId: params.agentId,
    routeSessionKey: params.sessionKey,
    storePath: params.storePath,
    ctxPayload: params.inboundContext,
    recordInboundSession,
    dispatchReplyWithBufferedBlockDispatcher: bufferedReply,
    delivery: {
      deliver: async (payload, info) => {
        if (signal?.aborted) {
          return;
        }
        return await params.delivery.deliver(payload, info);
      },
      onError: params.delivery.onError,
    },
    record: params.record,
    ...(signal ? { sessionInitRetry: { delaysMs: [], signal } } : {}),
  });
  if (signal?.aborted) {
    throw new DOMException("transcript dispatch cancelled", "AbortError");
  }
  return result;
}
