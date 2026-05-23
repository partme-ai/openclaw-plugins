/**
 * @module dispatch/transcript-dispatch
 *
 * Transcript 路径 dispatch：runAssembled 编排 + fallback record。
 *
 * **职责**：Gotify、企业微信、飞书等 IM 通道的标准入站入口；保证 Control UI 可见
 * user/agent 轮次。优先 `turn.runAssembled`，降级为 record + buffered reply。
 *
 * **关键导出**：`dispatchTranscriptTurn`
 */

import type { TranscriptDispatchParams } from "./types.js";

/**
 * Transcript 路径入站派发（IM 插件标准入口）/ Transcript-path inbound dispatch.
 *
 * 优先经 channel.turn.runAssembled 写入 Control UI transcript，再派发 Agent 回复。
 *
 * @param params - Transcript Runtime、session store、入站上下文、record 与 delivery 配置
 */
export async function dispatchTranscriptTurn(params: TranscriptDispatchParams): Promise<void> {
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

  /**
   * 派发失败时兜底写入 user 轮次 / Fallback: record inbound user turn on dispatch failure.
   *
   * runAssembled 可能在记录入站消息之前失败；不做 fallback 则 Control UI transcript 会空白。
   */
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

  // 完整能力路径：OpenClaw turn.runAssembled 统一完成入站记录、Agent run、回复缓冲
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

  // 降级路径：无 runAssembled，先写 user 轮次再派发 buffered reply
  if (cr.session?.recordInboundSession && storePath && sessionKey) {
    await cr.session.recordInboundSession(recordParams);
    await cr.reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx: inboundContext,
      cfg,
      dispatcherOptions: { deliver: delivery.deliver, onError: delivery.onError },
    });
    return;
  }

  // 最小能力路径：无 session 记录，仅执行回复派发
  await cr.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: inboundContext,
    cfg,
    dispatcherOptions: { deliver: delivery.deliver, onError: delivery.onError },
  });
}
