/**
 * @module bridge/inbound-bridge
 *
 * 入站桥接：UnifiedMessage / 文本 → OpenClaw finalizeInboundContext + dispatch。
 *
 * **职责**：完成 resolveAgentRoute、finalizeInboundContext、挂载 reply handler 并调用
 * dispatchReplyFromConfig；Wire 路径的核心实现。
 *
 * **关键导出**：`dispatchInbound`、`toInboundUnifiedMessage`
 */

import { buildMessage } from "../core/message.js";
import type { InboundBridgeParams, ReplyBridgeParams, ReplyBridgeResult } from "./types.js";
import { createReplyHandler } from "./reply-bridge.js";

/** dispatchInbound 入参（含 reply 配置）/ Dispatch inbound params with reply config */
export interface DispatchInboundParams extends InboundBridgeParams {
  reply: Omit<ReplyBridgeParams, "runtime" | "channel" | "accountId" | "peerId">;
}

/** dispatchInbound 返回值 / Dispatch inbound result */
export interface DispatchInboundResult extends ReplyBridgeResult {
  /** finalizeInboundContext 产出的 ctx / Inbound context from OpenClaw */
  ctx: Record<string, unknown>;
}

/**
 * 完成入站上下文构建、路由解析，并挂载回复分发器后 dispatch / Full inbound dispatch pipeline.
 *
 * 流程：resolveAgentRoute → finalizeInboundContext → createReplyHandler → dispatchReplyFromConfig。
 *
 * @param params - 入站参数与 reply 配置
 * @returns 含 ctx 与 reply 分发结果的 DispatchInboundResult
 */
export async function dispatchInbound(params: DispatchInboundParams): Promise<DispatchInboundResult> {
  const { runtime, channel, accountId, peerId, text, chatType, agentId, unified, extra, reply } =
    params;
  const cfg = runtime.config;

  const replyOptions = await runtime.channel.routing.resolveAgentRoute({
    cfg,
    channel,
    accountId,
    peer: { kind: "direct", id: peerId },
  });

  const ctx = await runtime.channel.reply.finalizeInboundContext({
    channel,
    accountId,
    from: peerId,
    text,
    chatType: chatType ?? "direct",
    extra: {
      ...extra,
      ...(unified?.messageId ? { unifiedMessageId: unified.messageId } : {}),
      ...(agentId ? { desiredAgentId: agentId } : {}),
    },
  });

  const { dispatcher } = createReplyHandler({
    runtime,
    channel,
    accountId,
    peerId,
    ...reply,
  });

  await runtime.channel.reply.dispatchReplyFromConfig({
    ctx,
    cfg,
    dispatcher,
    replyOptions,
  });

  return { ctx, dispatcher, replyOptions };
}

/**
 * 将原始入站参数规范为 UnifiedMessage（便于入栈）/ Normalize inbound params to UnifiedMessage.
 *
 * 若已提供 unified 则原样返回；否则用 buildMessage 构造 inbound 消息。
 *
 * @param params - 入站桥接参数
 */
export function toInboundUnifiedMessage(params: InboundBridgeParams): import("../core/types.js").UnifiedMessage {
  if (params.unified) {
    return params.unified;
  }
  return buildMessage({
    channel: params.channel,
    accountId: params.accountId,
    userId: params.peerId,
    agentId: params.agentId,
    text: params.text,
    chatType: params.chatType,
    direction: "inbound",
    metadata: params.extra,
  });
}
