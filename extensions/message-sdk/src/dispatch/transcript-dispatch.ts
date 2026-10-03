/** 标准 channel.inbound 路径的已组装 Transcript 派发。 */

import type { TranscriptDispatchParams, TranscriptDispatchResult } from "./types.js";

export type TranscriptRecordState = "not_started" | "ambiguous" | "recorded";

/** 宿主派发失败时保留用户轮次的可观察记录阶段，供传输层决定是否可安全重试。 */
export class TranscriptDispatchError extends Error {
  constructor(
    cause: unknown,
    readonly recordState: TranscriptRecordState,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = cause instanceof Error && cause.name === "AbortError"
      ? "AbortError"
      : "TranscriptDispatchError";
  }
}

/** 将一个已授权入站轮次交由宿主管理记录、Agent 执行与回复结算。 */
export async function dispatchTranscriptTurn(
  params: TranscriptDispatchParams,
): Promise<TranscriptDispatchResult> {
  const { channelRuntime, signal } = params;
  const dispatchReply = channelRuntime.inbound?.dispatchReply;
  const recordInboundSession = channelRuntime.session?.recordInboundSession;
  const bufferedReply = channelRuntime.reply?.dispatchReplyWithBufferedBlockDispatcher;
  if (!dispatchReply || !recordInboundSession || !bufferedReply || !params.storePath) {
    throw new TranscriptDispatchError(
      new Error("stable channel inbound transcript runtime is unavailable"),
      "not_started",
    );
  }
  if (signal?.aborted) {
    throw new TranscriptDispatchError(
      new DOMException("transcript dispatch cancelled", "AbortError"),
      "not_started",
    );
  }

  let recordState: TranscriptRecordState = "not_started";
  let observedFailure: unknown;
  let hasObservedFailure = false;
  const recordMetaTasks: Promise<unknown>[] = [];
  const result = await dispatchReply({
    cfg: params.cfg,
    channel: params.channel,
    accountId: params.accountId,
    agentId: params.agentId,
    routeSessionKey: params.sessionKey,
    storePath: params.storePath,
    ctxPayload: params.inboundContext,
    recordInboundSession: async (recordParams) => {
      recordState = "ambiguous";
      await recordInboundSession(recordParams);
      if (!hasObservedFailure) recordState = "recorded";
    },
    dispatchReplyWithBufferedBlockDispatcher: bufferedReply,
    delivery: {
      deliver: async (payload, info) => {
        if (signal?.aborted) {
          return;
        }
        return await params.delivery.deliver(payload, info);
      },
      onError: (error, info) => {
        observedFailure = error;
        hasObservedFailure = true;
        params.delivery.onError?.(error, info);
      },
    },
    record: {
      ...params.record,
      trackSessionMetaTask: (task) => {
        recordMetaTasks.push(task);
      },
      onRecordError: (error: unknown) => {
        recordState = "ambiguous";
        observedFailure = error;
        hasObservedFailure = true;
        params.record.onRecordError?.(error);
      },
    },
    ...(signal ? { replyOptions: { abortSignal: signal } } : {}),
  }).catch((error: unknown) => {
    throw new TranscriptDispatchError(error, recordState);
  });
  for (const task of await Promise.allSettled(recordMetaTasks)) {
    if (task.status === "rejected") {
      recordState = "ambiguous";
      observedFailure = task.reason;
      hasObservedFailure = true;
    }
  }
  if (signal?.aborted) {
    throw new TranscriptDispatchError(
      new DOMException("transcript dispatch cancelled", "AbortError"),
      recordState,
    );
  }
  if (hasObservedFailure) {
    throw new TranscriptDispatchError(observedFailure, recordState);
  }
  return result;
}
