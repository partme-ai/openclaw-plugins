/**
 * @module message-sender
 *
 * 企业微信 WS 出站回复发送（被动 replyStream + 事件主动 sendMessage）。
 *
 * **职责**：
 * - 通过 SDK `replyStream` / `replyStreamNonBlocking` 发送流式文本
 * - 事件回调（无有效 req_id）降级为 `sendMessage` 主动发送
 * - 识别 errcode **846608**（流式超过 6 分钟）并抛出 `StreamExpiredError` 供上层降级
 *
 * **适用场景**：`monitor`、`ws-reply-pipeline`、DM pairing 回复、outbound 通道。
 *
 * **上下游**：
 * - 上游：OpenClaw dispatch 增量/最终文本
 * - 下游：`@wecom/aibot-node-sdk` WSClient
 *
 * **关键导出**：`sendWeComReply`、`sendWeComReplyNonBlocking`、`StreamExpiredError`
 */

import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import { type WSClient, type WsFrame, generateReqId } from "@wecom/aibot-node-sdk";
import { REPLY_SEND_TIMEOUT_MS } from "../types/const.js";
import { withTimeout } from "../shared/timeout.js";

// ============================================================================
// 流式过期错误（errcode 846608）
// ============================================================================

/**
 * 流式回复超时错误码（>6 分钟未更新，服务端拒绝继续流式更新）。
 *
 * @see https://developer.work.weixin.qq.com/document/path/ — 智能机器人流式回复限制
 */
export const STREAM_EXPIRED_ERRCODE = 846608;

/**
 * 流式回复过期错误。
 *
 * 当服务端返回 errcode=846608 时抛出，表示流式消息已超过 6 分钟无法更新；
 * 调用方需降级为 `sendMessage` 主动发送方式回复。
 */
export class StreamExpiredError extends Error {
  readonly errcode = STREAM_EXPIRED_ERRCODE;
  constructor(message?: string) {
    super(message ?? `Stream message update expired (errcode=${STREAM_EXPIRED_ERRCODE})`);
    this.name = "StreamExpiredError";
  }
}

// ============================================================================
// 阻塞式流式发送
// ============================================================================

/**
 * 发送企业微信回复消息（阻塞等待 SDK ack，带超时保护）。
 *
 * **分支**：
 * - `msgtype === "event"`：无有效 req_id → `sendMessage` 主动发送（仅 finish 帧）
 * - 普通消息：`replyStream(frame, streamId, text, finish)`
 *
 * @param params.wsClient - 已连接 WS 客户端
 * @param params.frame - 入站帧（被动回复关联 req_id）
 * @param params.text - 回复文本（空则跳过）
 * @param params.runtime - 运行时日志
 * @param params.finish - 是否为流式最终帧，默认 `true`
 * @param params.streamId - 流式 ID（增量帧需复用同一 streamId）
 * @returns streamId；空文本时返回 `""`
 * @throws {StreamExpiredError} errcode 846608
 * @throws {Error} 未连接或发送超时
 */
export async function sendWeComReply(params: {
  wsClient: WSClient;
  frame: WsFrame;
  text?: string;
  runtime: RuntimeEnv;
  /** 是否为流式回复的最终消息，默认为 true */
  finish?: boolean;
  /** 指定 streamId，用于流式回复时保持相同的 streamId */
  streamId?: string;
}): Promise<string> {
  const { wsClient, frame, text, runtime, finish = true, streamId: existingStreamId } = params;

  if (!text) {
    return "";
  }

  const streamId = existingStreamId || generateReqId("stream");

  if (!wsClient.isConnected) {
    runtime.error?.(`[wecom] WSClient not connected, cannot send reply`);
    throw new Error("WSClient not connected");
  }

  const body = frame.body as {
    msgtype?: string;
    chatid?: string;
    from?: {
      userid?: string;
    };
  };

  // -------------------------------------------------------------------------
  // 事件回调：aibot_event_callback 无有效 req_id，不能用 replyStream（会 846605）
  // -------------------------------------------------------------------------
  if (body.msgtype === "event") {
    // 中间帧（thinking / 流式增量）直接跳过，仅在最终帧主动发一次文本。
    if (!finish) {
      runtime.log?.(`[plugin -> server] skip non-final stream for event callback, streamId=${streamId}`);
      return streamId;
    }

    const chatId = body.chatid || body.from?.userid;
    if (!chatId) {
      throw new Error("Missing chatId for event callback reply");
    }

    await withTimeout(
      wsClient.sendMessage(chatId, {
        msgtype: "markdown",
        markdown: { content: text },
      }),
      REPLY_SEND_TIMEOUT_MS,
      `Event reply send timed out (streamId=${streamId})`,
    );
    runtime.log?.(`[plugin -> server] event-active-send chatId=${chatId}, finish=${finish}`);
    return streamId;
  }

  // -------------------------------------------------------------------------
  // 普通消息：被动 replyStream（关联入站 req_id）
  // -------------------------------------------------------------------------
  try {
    await withTimeout(
      wsClient.replyStream(frame, streamId, text, finish),
      REPLY_SEND_TIMEOUT_MS,
      `Reply send timed out (streamId=${streamId})`,
    );
  } catch (err: any) {
    // 服务端返回 846608：流式消息超过6分钟无法更新，需降级为主动发送
    const errMsg = err?.errmsg || err?.message || String(err);
    if (
      err?.errcode === STREAM_EXPIRED_ERRCODE ||
      errMsg.includes(String(STREAM_EXPIRED_ERRCODE))
    ) {
      throw new StreamExpiredError(errMsg);
    }
    throw err;
  }
  runtime.log?.(`[plugin -> server] streamId=${streamId}, finish=${finish}`);

  return streamId;
}

// ============================================================================
// 非阻塞流式发送（onPartialReply 场景）
// ============================================================================

/**
 * 非阻塞流式文本回复（基于 SDK `replyStreamNonBlocking`）。
 *
 * **背压策略**：若上一条同 reqId 消息尚未 ack，则跳过本次中间帧（返回 `'skipped'`），
 * 避免流式增量排队积压导致延迟；`finish=true` 的最终帧不受此限制。
 *
 * @param params.wsClient - WS 客户端
 * @param params.frame - 入站帧
 * @param params.text - 增量文本
 * @param params.runtime - 运行时日志
 * @param params.streamId - 流式 ID（全链路复用）
 * @param params.finish - 是否关流，默认 `false`
 * @returns `'skipped'` 表示被跳过；否则返回 streamId
 * @throws {StreamExpiredError} errcode 846608
 */
export async function sendWeComReplyNonBlocking(params: {
  wsClient: WSClient;
  frame: WsFrame;
  text: string;
  runtime: RuntimeEnv;
  streamId: string;
  finish?: boolean;
}): Promise<string | 'skipped'> {
  const { wsClient, frame, text, runtime, streamId, finish = false } = params;

  if (!text) {
    return 'skipped';
  }

  if (!wsClient.isConnected) {
    return 'skipped';
  }

  try {
    const result = await wsClient.replyStreamNonBlocking(frame, streamId, text, finish);
    if (result === 'skipped') {
      return 'skipped';
    }
    return streamId;
  } catch (err: any) {
    // 服务端返回 846608：流式消息超过6分钟无法更新，需降级为主动发送
    const errMsg = err?.errmsg || err?.message || String(err);
    if (
      err?.errcode === STREAM_EXPIRED_ERRCODE ||
      errMsg.includes(String(STREAM_EXPIRED_ERRCODE))
    ) {
      throw new StreamExpiredError(errMsg);
    }
    throw err;
  }
}
