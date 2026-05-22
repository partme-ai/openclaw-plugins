/**
 * Transcript 路径 dispatch：runAssembled 编排 + fallback record。
 *
 * Transcript 路径用于 Gotify、企业微信、飞书等人类 IM 通道。它的产品约束是：
 * Control UI 中必须能看到用户轮次和 Agent 回复轮次，所以优先使用 OpenClaw
 * `turn.runAssembled`。当宿主 Runtime 缺少该能力时，本文件降级为 record + buffered reply。
 */

import type { TranscriptDispatchParams } from "./types.js";

/**
 * Transcript 路径入站派发（IM 插件标准入口）。
 *
 * 优先经 channel.turn.runAssembled 写入 Control UI transcript，再派发 Agent 回复。
 *
 * @param params - Transcript Runtime、session store、入站上下文、record 回调和最终 deliver 配置。
 * @returns 无返回值；回复投递由 `delivery.deliver` 完成。
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
   * 派发失败时兜底写入 user 轮次。
   *
   * 关键点：`runAssembled` 可能在记录入站消息之前失败。如果不做 fallback，
   * 用户在 IM 内发了消息，但 Control UI transcript 会空白，后续排查无法复盘上下文。
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

  // 完整能力路径：由 OpenClaw turn.runAssembled 统一完成入站记录、Agent run 和回复缓冲。
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

  // 降级路径：没有 runAssembled，但仍能记录 session，此时先写 user 轮次再派发回复。
  if (cr.session?.recordInboundSession && storePath && sessionKey) {
    await cr.session.recordInboundSession(recordParams);
    await cr.reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx: inboundContext,
      cfg,
      dispatcherOptions: { deliver: delivery.deliver, onError: delivery.onError },
    });
    return;
  }

  // 最小能力路径：宿主没有 session 记录能力，仅执行回复派发，保证插件仍能响应。
  await cr.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: inboundContext,
    cfg,
    dispatcherOptions: { deliver: delivery.deliver, onError: delivery.onError },
  });
}
