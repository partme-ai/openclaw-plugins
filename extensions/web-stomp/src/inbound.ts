/**
 * Web STOMP 入站分发（message-sdk Wire 路径）。
 */

import { createIdempotencyCache } from "@partme.ai/openclaw-message-sdk";
import {
  normalizeWireIngress,
  createChannelDispatch,
  resolveChannelDispatchIdentity,
  type BridgePluginRuntime,
} from "@partme.ai/openclaw-message-sdk/bridge";
import { getWebStompRuntime } from "./runtime.js";

/** Web STOMP 入站幂等缓存。 */
const idempotencyCache = createIdempotencyCache({ ttlMs: 60_000, maxEntries: 10_000 });

/** Web STOMP 入站上下文（协议层 → Wire ingress）。 */
export type WebStompInboundContext = {
  peerId: string;
  agentId?: string;
  destination: string;
  rawPayload: string;
  idempotencyKey?: string;
};

/**
 * 将入站 STOMP SEND 分发到 OpenClaw（normalizeWireIngress → createChannelDispatch）。
 */
export async function dispatchInboundStomp(ctx: WebStompInboundContext): Promise<void> {
  const runtime = getWebStompRuntime();
  if (!runtime) {
    console.warn("[openclaw_web_stomp] Runtime not initialized, cannot dispatch message");
    return;
  }

  const agentIdHint = ctx.agentId ?? "main";
  const { agentId, sessionKey } = await resolveChannelDispatchIdentity(runtime as unknown as BridgePluginRuntime, {
    channel: "stomp",
    accountId: "default",
    peerId: ctx.peerId,
    agentId: agentIdHint,
  });

  const replyDestination = `/topic/session.${ctx.peerId}`;

  const parsed = normalizeWireIngress({
    rawPayload: ctx.rawPayload,
    mode: "jsonTextOrPlain",
    channel: "stomp",
    idempotencyKey: ctx.idempotencyKey,
    idempotency: ctx.idempotencyKey ? idempotencyCache : undefined,
  });
  if (!parsed.accepted) {
    console.log(`[openclaw_web_stomp] Duplicate inbound dropped: ${ctx.idempotencyKey}`);
    return;
  }

  await createChannelDispatch({
    mode: "reply-pipeline",
    runtime: runtime as unknown as BridgePluginRuntime,
    channel: "stomp",
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
