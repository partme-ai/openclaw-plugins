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
import {
  getWebStompIdempotencyCache,
  mapWebStompWirePayloadMode,
} from "./shared/wire-helpers.js";

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
 * @returns Promise；runtime 未初始化或重复消息时静默返回
 */
export async function dispatchInboundStomp(ctx: WebStompInboundContext): Promise<void> {
  const runtime = getWebStompRuntime();
  if (!runtime) {
    console.warn("[openclaw-web-stomp] Runtime not initialized, cannot dispatch message");
    return;
  }

  const agentIdHint = ctx.agentId ?? "main";
  const { agentId, sessionKey } = await resolveChannelDispatchIdentity(runtime as unknown as BridgePluginRuntime, {
    channel: WEB_STOMP_CHANNEL_ID,
    accountId: "default",
    peerId: ctx.peerId,
    agentId: agentIdHint,
  });

  const replyDestination = `/topic/session.${ctx.peerId}`;

  const idempotencyCache = getWebStompIdempotencyCache();
  const parsed = normalizeWireIngress({
    rawPayload: ctx.rawPayload,
    mode: mapWebStompWirePayloadMode("jsonTextOrPlain"),
    channel: WEB_STOMP_CHANNEL_ID,
    idempotencyKey: ctx.idempotencyKey,
    idempotency: ctx.idempotencyKey ? idempotencyCache : undefined,
  });
  if (!parsed.accepted) {
    console.log(`[openclaw-web-stomp] Duplicate inbound dropped: ${ctx.idempotencyKey}`);
    return;
  }

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
        publishToDestination(replyDestination, wire);
      },
      outboundFormat: "envelope",
      replyRoute: { destination: replyDestination },
      agentId,
    },
  });
}
