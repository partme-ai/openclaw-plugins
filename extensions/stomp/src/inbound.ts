/**
 * @fileoverview STOMP 入站 dispatch：message-sdk 桥接 OpenClaw reply 管线。
 *
 * @description
 * 接收 transport 层 `InboundMessage`，经 `normalizeWireIngress` 与
 * `dispatchChannelMessage` 驱动 Agent；回复经 `publishToDestination` 写回 STOMP。
 *
 * @module inbound
 */

/**
 * STOMP 入站 — Base Profile 入口。
 */

import {
  normalizeWireIngress,
  dispatchChannelMessage,
  resolveChannelDispatchIdentity,
  type BridgePluginRuntime,
} from "@partme.ai/openclaw-message-sdk/bridge";
import { STOMP_TCP_CHANNEL_ID } from "./config/resolvers.js";
import { getStompRuntime } from "./runtime.js";
import { resolvePayloadMode } from "@partme.ai/openclaw-message-sdk/transport";
import {
  getStompTcpClaimableDedupe,
} from "./shared/wire-helpers.js";
import { publishToDestination } from "./transport/server.js";
import type { InboundMessage } from "./types.js";

/**
 * @description 将 STOMP 入站消息分发到 OpenClaw Runtime reply 管线。
 * @param message - transport 层路由后的入站消息。
 * @returns Promise，成功时无返回值。
 * @throws runtime 未初始化或 dispatch 失败时抛出/打日志。
 */
export async function dispatchInboundMessage(message: InboundMessage): Promise<void> {
  const runtime = getStompRuntime();
  if (!runtime) {
    throw new Error("STOMP runtime is not initialized");
  }

  const parsed = normalizeWireIngress({
    rawPayload: message.rawPayload,
    mode: resolvePayloadMode("jsonTextOrPlain"),
    channel: STOMP_TCP_CHANNEL_ID,
  });
  if (!parsed.text.trim()) {
    throw new Error("STOMP inbound payload is empty");
  }

  const dedupe = getStompTcpClaimableDedupe();
  const claim = message.idempotencyKey
    ? await dedupe.claim(message.idempotencyKey)
    : undefined;
  if (claim && (claim.kind === "duplicate" || claim.kind === "inflight")) return;

  const replyDestination = message.replyDestination ?? `/topic/session.${message.peerId}`;

  try {
    const { agentId, sessionKey } = await resolveChannelDispatchIdentity(runtime as unknown as BridgePluginRuntime, {
      channel: STOMP_TCP_CHANNEL_ID,
      accountId: message.accountId,
      peerId: message.peerId,
      agentId: message.agentId,
    });

    await dispatchChannelMessage({
      mode: "reply-pipeline",
      runtime: runtime as unknown as BridgePluginRuntime,
      channel: STOMP_TCP_CHANNEL_ID,
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
          const delivered = publishToDestination(replyDestination, wire);
          if (delivered < 1) {
            throw new Error(`No STOMP subscriber accepted reply destination: ${replyDestination}`);
          }
        },
        outboundFormat: "envelope",
        replyRoute: { destination: replyDestination },
        agentId,
      },
    });
    if (message.idempotencyKey) await dedupe.commit(message.idempotencyKey);
  } catch (error) {
    if (message.idempotencyKey) dedupe.release(message.idempotencyKey);
    throw error;
  }
}
