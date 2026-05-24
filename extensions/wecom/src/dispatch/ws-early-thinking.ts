/**
 * @module ws-early-thinking
 *
 * WebSocket 协议首帧 thinking 占位（policy 通过后、媒体下载与队列等待之前）。
 */

import { generateReqId } from "@wecom/aibot-node-sdk";
import type { WSClient, WsFrame } from "@wecom/aibot-node-sdk";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import { resolveWecomTemplates } from "../config/templates.js";
import type { ResolvedWeComAccount } from "../config/wecom-config.js";
import type { MessageState } from "../types/interface.js";
import { pushWecomStreamStatusLine, sendThinkingReply } from "../webhook/ws-reply-pipeline.js";
import { logWsTimingStage, type WsTimingContext } from "./ws-timing.js";

/** 生成 WS 流式回复 streamId。 */
export function createWecomEarlyThinkingStreamId(): string {
  return generateReqId("stream");
}

/**
 * 是否应对当前账号发送 early thinking 首帧。
 *
 * @param account - 已解析企微账号
 */
export function shouldSendWecomEarlyThinking(account: ResolvedWeComAccount): boolean {
  return account.sendThinkingMessage ?? true;
}

/**
 * 在 policy 通过后尽快发送 thinking 占位（使用非阻塞 replyStream）。
 *
 * @returns 是否已成功发起首帧发送
 */
export async function sendWecomEarlyThinking(params: {
  wsClient: WSClient;
  frame: WsFrame;
  streamId: string;
  account: ResolvedWeComAccount;
  runtime: RuntimeEnv;
  timing?: WsTimingContext;
  /** 可选；传入时写入 statusLine */
  state?: MessageState;
}): Promise<boolean> {
  const { wsClient, frame, streamId, account, runtime, timing, state } = params;
  if (!shouldSendWecomEarlyThinking(account)) {
    return false;
  }

  if (timing) {
    logWsTimingStage(timing, "thinking.early.attempt", undefined, { runtime });
  }

  const templates = resolveWecomTemplates(account);
  try {
    await sendThinkingReply({
      wsClient,
      frame,
      streamId,
      runtime,
      account,
      state,
      templates,
    });
    if (timing) {
      logWsTimingStage(timing, "thinking.early.sent", undefined, { runtime });
    }
    return true;
  } catch (err) {
    runtime.error?.(`[wecom] Early thinking reply failed: ${String(err)}`);
    if (timing) {
      logWsTimingStage(timing, "thinking.early.failed", undefined, { runtime });
    }
    return false;
  }
}

/**
 * 非阻塞触发 early thinking（不 await SDK 完成，仅捕获 rejection）。
 *
 * WHY：prepare 阶段需立即继续媒体下载或入队，首帧发送本身已是 replyStreamNonBlocking。
 */
export function fireWecomEarlyThinking(params: Parameters<typeof sendWecomEarlyThinking>[0]): void {
  void sendWecomEarlyThinking(params).catch((err) => {
    params.runtime.error?.(`[wecom] Early thinking fire failed: ${String(err)}`);
  });
}

/**
 * 同会话排队时，将 early stream 状态栏更新为 queuedText（需 prepare 已发首帧）。
 *
 * @returns 是否已推送 queued 状态
 */
export async function pushWecomQueuedStatusIfNeeded(params: {
  wsClient: WSClient;
  frame: WsFrame;
  streamId?: string;
  thinkingSentEarly?: boolean;
  account: ResolvedWeComAccount;
  runtime: RuntimeEnv;
}): Promise<boolean> {
  const { wsClient, frame, streamId, thinkingSentEarly, account, runtime } = params;
  if (!thinkingSentEarly || !streamId) {
    return false;
  }
  const templates = resolveWecomTemplates(account);
  await pushWecomStreamStatusLine({
    wsClient,
    frame,
    streamId,
    runtime,
    account,
    statusLine: templates.queued,
  });
  return true;
}
