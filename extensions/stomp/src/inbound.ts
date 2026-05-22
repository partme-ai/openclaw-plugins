/**
 * STOMP TCP 入站分发：经 message-sdk OpenClaw 桥接。
 */

import { createIdempotencyCache } from "@partme.ai/openclaw-message-sdk";
import {
  normalizeWireIngress,
  dispatchChannelMessage,
  resolveChannelDispatchIdentity,
  type BridgePluginRuntime,
} from "@partme.ai/openclaw-message-sdk/bridge";
import { getStompRuntime } from "./runtime.js";
import { publishToDestination } from "./transport/server.js";
import type { InboundMessage } from "./types.js";

/** STOMP TCP 入站幂等缓存。 */
const idempotencyCache = createIdempotencyCache({ ttlMs: 60_000, maxEntries: 10_000 });

/**
 * 将 STOMP 入站消息分发到 OpenClaw Runtime。
 */
export async function dispatchInboundMessage(message: InboundMessage): Promise<void> {
  const runtime = getStompRuntime();
  if (!runtime) {
    console.warn("[openclaw-stomp] Runtime not initialized, cannot dispatch message");
    return;
  }

  const parsed = normalizeWireIngress({
    rawPayload: message.rawPayload,
    mode: "jsonTextOrPlain",
    channel: "stomp-tcp",
    idempotencyKey: message.idempotencyKey,
    idempotency: message.idempotencyKey ? idempotencyCache : undefined,
  });
  if (!parsed.accepted) {
    console.log(`[openclaw-stomp] Duplicate inbound dropped: ${message.idempotencyKey}`);
    return;
  }

  const replyDestination = message.replyDestination ?? `/topic/session.${message.peerId}`;

  const { agentId, sessionKey } = await resolveChannelDispatchIdentity(runtime as unknown as BridgePluginRuntime, {
    channel: "stomp-tcp",
    accountId: message.accountId,
    peerId: message.peerId,
    agentId: message.agentId,
  });

  await dispatchChannelMessage({
    mode: "reply-pipeline",
    runtime: runtime as unknown as BridgePluginRuntime,
    channel: "stomp-tcp",
    accountId: message.accountId,
    peerId: message.peerId,
    text: parsed.text,
    agentId,
    sessionKey,
    unified: parsed.unified,
    extra: {
      stompDestination: message.destination,
      stompReplyDestination: replyDestination,
    },
    reply: {
      deliver: async ({ wire }: { wire: string }) => {
        publishToDestination(replyDestination, wire);
      },
      outboundFormat: "envelope",
      replyRoute: { destination: replyDestination },
      agentId,
    },
  });
}
