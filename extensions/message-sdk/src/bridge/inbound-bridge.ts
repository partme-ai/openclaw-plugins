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
import { resolveBridgeRuntimeConfig } from "./runtime-config.js";
import { classifyDeliveryOutcome, type DeliveryOutcome, type ReplyDispatchReceipt } from "../dispatch/delivery-outcome.js";

/** dispatchInbound 入参（含 reply 配置）/ Dispatch inbound params with reply config */
export interface DispatchInboundParams extends InboundBridgeParams {
  /** Persist Agent start only after all runtime/context preflight has passed. */
  beforeAgentDispatch?: () => void;
  reply: Omit<ReplyBridgeParams, "runtime" | "channel" | "accountId" | "peerId">;
}

/** dispatchInbound 返回值 / Dispatch inbound result */
export interface DispatchInboundResult extends ReplyBridgeResult {
  /** finalizeInboundContext 产出的 ctx / Inbound context from OpenClaw */
  ctx: Record<string, unknown>;
  receipt?: ReplyDispatchReceipt;
  deliveryOutcome: DeliveryOutcome;
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
  const cfg = await resolveBridgeRuntimeConfig(runtime);

  const replyOptions = await runtime.channel.routing.resolveAgentRoute({
    cfg,
    channel,
    accountId,
    peer: { kind: "direct", id: peerId },
  });

  // OpenClaw's finalized inbound context is a legacy-compatible MsgContext
  // contract whose canonical fields are PascalCase. Lower-case transport
  // fields are ignored by finalizeInboundContext and result in an empty agent
  // body on OpenClaw 2026.7.1.
  const ctx = await runtime.channel.reply.finalizeInboundContext({
    Body: text,
    BodyForAgent: text,
    RawBody: text,
    CommandBody: text,
    From: peerId,
    To: accountId,
    SessionKey: reply.sessionKey,
    AccountId: accountId,
    ChatType: chatType ?? "direct",
    SenderId: peerId,
    Provider: channel,
    Surface: channel,
    OriginatingChannel: channel,
    OriginatingTo: accountId,
    CommandAuthorized: false,
    ...(unified?.messageId
      ? { MessageSid: unified.messageId, MessageSidFull: unified.messageId }
      : {}),
    ...(agentId ? { DesiredAgentId: agentId } : {}),
    ...extra,
  });

  const { dispatcher } = createReplyHandler({
    runtime,
    channel,
    accountId,
    peerId,
    ...reply,
  });

  params.beforeAgentDispatch?.();
  const dispatchResult = await runtime.channel.reply.dispatchReplyFromConfig({
    ctx,
    cfg,
    dispatcher,
    replyOptions,
  });

  // OpenClaw's reply dispatcher may still be draining an asynchronous
  // transport delivery after dispatchReplyFromConfig resolves. Wire/MQ
  // consumers must not treat the inbound message as complete until that
  // delivery has settled, otherwise deferred ACK can race the publish confirm.
  const waitForIdle = (dispatcher as { waitForIdle?: () => Promise<ReplyDispatchReceipt> } | undefined)
    ?.waitForIdle;
  let idleReceipt: ReplyDispatchReceipt | undefined;
  if (typeof waitForIdle === "function") {
    idleReceipt = await waitForIdle.call(dispatcher);
  }
  const receipt = idleReceipt ?? dispatchResult?.settledReceipt;
  const terminal = dispatchResult?.deliberateSilentTerminalReply
    ? "silent"
    : dispatchResult?.deferredToActiveRun || receipt?.hasPendingDelivery
      ? "pending"
      : receipt?.anyVisibleDelivered
        ? "visible"
        : dispatchResult && dispatchResult.queuedFinal === false &&
            Object.values(dispatchResult.counts ?? {}).every((count) => count === 0)
          ? "empty"
          : "failed";

  return { ctx, dispatcher, replyOptions, receipt, deliveryOutcome: classifyDeliveryOutcome(receipt, terminal) };
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
