/**
 * Web STOMP 入站分发（message-sdk Wire 路径）。
 */

import {
  normalizeWireIngress,
  dispatchChannelMessage,
  resolveChannelDispatchIdentity,
  type BridgePluginRuntime,
} from "@partme.ai/openclaw-message-sdk/bridge";
import { WEB_STOMP_CHANNEL_ID } from "./config/resolvers.js";
import { getWebStompRuntime } from "./runtime.js";
import { resolvePayloadMode } from "@partme.ai/openclaw-message-sdk/transport";
import {
  getWebStompClaimableDedupe,
} from "./shared/wire-helpers.js";

const DEFAULT_PAYLOAD_MODE = "jsonTextOrPlain" as const;

/** Web STOMP 入站上下文（协议层 → Wire ingress）。 */
export type WebStompInboundContext = {
  peerId: string;
  agentId?: string;
  destination: string;
  rawPayload: string;
  idempotencyKey?: string;
};

/**
 * 将入站 STOMP SEND 分发到 OpenClaw（normalizeWireIngress → dispatchChannelMessage）。
 *
 * @param ctx - 含 peerId、destination、rawPayload 的入站上下文
 * @returns Promise；重复或正在处理的消息静默返回
 * @throws runtime 未初始化、载荷为空、Agent 派发或回复投递失败时抛出
 */
export async function dispatchInboundStomp(ctx: WebStompInboundContext): Promise<void> {
  const runtime = getWebStompRuntime();
  if (!runtime) {
    throw new Error("Web STOMP runtime is not initialized");
  }

  const agentIdHint = ctx.agentId ?? "main";
  const { agentId, sessionKey } = await resolveChannelDispatchIdentity(runtime as unknown as BridgePluginRuntime, {
    channel: WEB_STOMP_CHANNEL_ID,
    accountId: "default",
    peerId: ctx.peerId,
    agentId: agentIdHint,
  });

  const replyDestination = `/topic/session.${ctx.peerId}`;

  const parsed = normalizeWireIngress({
    rawPayload: ctx.rawPayload,
    mode: resolvePayloadMode(DEFAULT_PAYLOAD_MODE),
    channel: WEB_STOMP_CHANNEL_ID,
  });
  if (!parsed.text.trim()) {
    throw new Error("Web STOMP inbound payload is empty");
  }

  const dedupe = getWebStompClaimableDedupe();
  const claim = ctx.idempotencyKey
    ? await dedupe.claim(ctx.idempotencyKey)
    : undefined;
  if (claim && (claim.kind === "duplicate" || claim.kind === "inflight")) return;

  try {
    await dispatchChannelMessage({
    mode: "reply-pipeline",
    runtime: runtime as unknown as BridgePluginRuntime,
    channel: WEB_STOMP_CHANNEL_ID,
    accountId: "default",
    peerId: ctx.peerId,
    text: parsed.text,
    agentId,
    sessionKey,
    unified: parsed.unified,
    extra: {
      stompReplyDestination: replyDestination,
      stompDestination: ctx.destination,
      sessionKey,
    },
    reply: {
      deliver: async ({ wire }: { wire: string }) => {
        const { publishToDestination } = await import("./transport/server.js");
        const delivered = publishToDestination(replyDestination, wire);
        if (delivered < 1) {
          throw new Error(`No Web STOMP subscriber accepted reply destination: ${replyDestination}`);
        }
      },
      outboundFormat: "envelope",
      replyRoute: { destination: replyDestination },
      agentId,
    },
    });
    if (ctx.idempotencyKey) await dedupe.commit(ctx.idempotencyKey);
  } catch (error) {
    if (ctx.idempotencyKey) dedupe.release(ctx.idempotencyKey);
    throw error;
  }
}
