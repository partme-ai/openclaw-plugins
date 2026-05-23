/**
 * 入站桥接：UnifiedMessage / 文本 → OpenClaw finalizeInboundContext + dispatch。
 */

import { buildMessage } from "../core/message.js";
import type { InboundBridgeParams, ReplyBridgeParams, ReplyBridgeResult } from "./types.js";
import { createReplyHandler } from "./reply-bridge.js";

/**
 * DispatchInboundParams 描述 bridge 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface DispatchInboundParams extends InboundBridgeParams {
  reply: Omit<ReplyBridgeParams, "runtime" | "channel" | "accountId" | "peerId">;
}

/**
 * DispatchInboundResult 描述 bridge 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface DispatchInboundResult extends ReplyBridgeResult {
  ctx: Record<string, unknown>;
}

/**
 * 完成入站上下文构建、路由解析，并挂载回复分发器后 dispatch。
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
 * 将原始入站参数规范为 UnifiedMessage（便于入栈）。
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
