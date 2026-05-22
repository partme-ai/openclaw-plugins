/**
 * Transcript 路径 dispatch：runAssembled 编排 + fallback record。
 */

import type { TranscriptDispatchParams } from "./types.js";

/**
 * Transcript 路径入站派发（IM 插件标准入口）。
 * 优先经 channel.turn.runAssembled 写入 Control UI transcript，再派发 Agent 回复。
 */
export async function createTranscriptDispatch(params: TranscriptDispatchParams): Promise<void> {
  const {
    channelRuntime: cr,
    cfg,
    channel,
    accountId,
    agentId,
    sessionKey,
    storePath,
    inboundContext,
    record,
    delivery,
  } = params;

  const recordParams = {
    storePath: storePath!,
    sessionKey,
    ctx: inboundContext,
    updateLastRoute: record.updateLastRoute,
    onRecordError: record.onRecordError,
  };

  /** 派发失败时兜底写入 user 轮次（runAssembled 在 record 前崩溃时 Control UI 不空白）。 */
  const recordInboundFallback = async (): Promise<void> => {
    if (!cr.session?.recordInboundSession || !storePath || !sessionKey) {
      return;
    }
    try {
      await cr.session.recordInboundSession(recordParams);
    } catch (err) {
      record.onRecordError?.(err);
    }
  };

  if (cr.turn?.runAssembled && cr.session?.recordInboundSession && storePath && sessionKey) {
    try {
      await cr.turn.runAssembled({
        cfg,
        channel,
        accountId,
        agentId,
        routeSessionKey: sessionKey,
        storePath,
        ctxPayload: inboundContext,
        recordInboundSession: cr.session.recordInboundSession,
        dispatchReplyWithBufferedBlockDispatcher: cr.reply.dispatchReplyWithBufferedBlockDispatcher,
        delivery,
        record: {
          updateLastRoute: record.updateLastRoute,
          onRecordError: record.onRecordError,
        },
      });
    } catch (dispatchErr) {
      await recordInboundFallback();
      throw dispatchErr;
    }
    return;
  }

  if (cr.session?.recordInboundSession && storePath && sessionKey) {
    await cr.session.recordInboundSession(recordParams);
    await cr.reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx: inboundContext,
      cfg,
      dispatcherOptions: { deliver: delivery.deliver, onError: delivery.onError },
    });
    return;
  }

  if (cr.session?.recordInboundSession && storePath && sessionKey) {
    await cr.session.recordInboundSession(recordParams);
  }

  await cr.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: inboundContext,
    cfg,
    dispatcherOptions: { deliver: delivery.deliver, onError: delivery.onError },
  });
}
