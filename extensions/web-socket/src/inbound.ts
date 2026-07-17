/**
 * @module web-socket/inbound
 *
 * WebSocket 入站：路由、幂等、message-sdk dispatch、回复经同一连接推送。
 *
 * 这里故意不吞掉异常：只有 Agent 管线和回复投递都成功，传输层才发送 accepted。
 * 若连接已经关闭或慢消费者触发背压，失败会沿 Promise 返回给 server/client 队列，避免产生
 * “服务端看似成功、调用方永远收不到回复”的假成功。
 */

import {
  dispatchChannelMessage,
  normalizeWireIngress,
  resolveChannelDispatchIdentity,
  type BridgePluginRuntime,
} from "@partme.ai/openclaw-message-sdk/bridge";

import {
  DEFAULT_WEBSOCKET_CONFIG,
  type WebsocketChannelConfig,
} from "./config.js";
import { resolveInboundRoute } from "./routing/agent-router.js";
import { upsertSessionContext } from "./routing/session-mapper.js";
import { getWebsocketRuntime } from "./runtime.js";
import { getWebsocketClaimableDedupe } from "./shared/wire-helpers.js";
import { getWebsocketChannelConfig } from "./state/web-socket-state.js";
import type { WebsocketInboundMessage } from "./types.js";
import { serializeEnvelopeReplyFrame, serializeReplyFrame } from "./transport/protocol.js";
import { WS_CLIENT_CONNECTION_PREFIX } from "./transport/client.js";
import { sendToConnectionConfirmed } from "./transport/connection-hub.js";

const inboundDedupe = getWebsocketClaimableDedupe();

/**
 * 解析 OpenClaw 对端 peerId（服务端=connectionId；客户端=帧内 peerId 或 clientId）。
 */
function resolvePeerId(
  message: WebsocketInboundMessage,
  config: WebsocketChannelConfig,
): string {
  if (message.peerId?.trim()) {
    return message.peerId.trim();
  }
  if (message.connectionId.startsWith(WS_CLIENT_CONNECTION_PREFIX)) {
    return config.client.clientId;
  }
  return message.connectionId;
}

/**
 * 处理 WebSocket 入站 message 帧。
 */
export async function handleInboundMessage(message: WebsocketInboundMessage): Promise<void> {
  const config = getWebsocketChannelConfig() ?? DEFAULT_WEBSOCKET_CONFIG;
  const route = resolveInboundRoute(
    message.connectionId,
    config,
    message.frameAgentId,
  );
  if (!route) {
    throw new Error("No agent route: set defaultAgentId or agentBindings");
  }

  const rt = getWebsocketRuntime();
  if (!rt) {
    throw new Error("OpenClaw runtime is not initialized");
  }

  const peerId = resolvePeerId(message, config);
  const { agentId, sessionKey } = await resolveChannelDispatchIdentity(
    rt as unknown as BridgePluginRuntime,
    {
      channel: "web-socket",
      accountId: route.accountId,
      peerId,
      agentId: route.agentId,
    },
  );

  const parsed = normalizeWireIngress({
    rawPayload: message.rawPayload,
    mode: config.payload.mode,
    channel: "web-socket",
  });
  const idempotencyKey = message.messageId?.trim();
  const claim = idempotencyKey ? await inboundDedupe.claim(idempotencyKey) : undefined;
  if (claim && (claim.kind === "duplicate" || claim.kind === "inflight")) {
    return;
  }

  upsertSessionContext(sessionKey, {
    connectionId: message.connectionId,
    agentId,
    accountId: route.accountId,
  });

  const text = parsed.text;
  try {
    await dispatchToRuntime(
      sessionKey,
      peerId,
      agentId,
      text,
      message,
      route.accountId,
      parsed.unified,
      config,
    );
    if (idempotencyKey) await inboundDedupe.commit(idempotencyKey);
  } catch (error) {
    // accepted 尚未发出时必须释放 claim，否则上游按 messageId 重试会被当成已完成而永久丢失。
    if (idempotencyKey) inboundDedupe.release(idempotencyKey, { error });
    throw error;
  }
}

/**
 * 经 message-sdk reply 管线派发，deliver 写回 WebSocket。
 */
async function dispatchToRuntime(
  sessionKey: string,
  peerId: string,
  agentId: string,
  text: string,
  inbound: WebsocketInboundMessage,
  accountId: string,
  unified: import("@partme.ai/openclaw-message-sdk").UnifiedMessage | null,
  config: WebsocketChannelConfig,
): Promise<void> {
  const rt = getWebsocketRuntime();
  if (!rt) {
    throw new Error("OpenClaw runtime is not initialized");
  }

  const outboundFormat =
    config.payload.outboundFormat === "plain" ? "plainText" : "envelope";

  await dispatchChannelMessage({
    mode: "reply-pipeline",
    runtime: rt as unknown as BridgePluginRuntime,
    channel: "web-socket",
    accountId,
    peerId,
    text,
    agentId,
    sessionKey,
    unified,
    extra: {
      connectionId: inbound.connectionId,
      peerId,
      messageId: inbound.messageId,
      sessionKey,
    },
    reply: {
      deliver: async ({ wire }: { wire: Uint8Array | string }) => {
        const payload =
          typeof wire === "string" ? wire : Buffer.from(wire).toString("utf8");
        if (config.payload.outboundFormat === "plain") {
          const delivered = await sendToConnectionConfirmed(
            inbound.connectionId,
            serializeReplyFrame(payload, { sessionKey }),
            config.limits.maxBufferedBytes,
            config.limits.sendTimeoutMs,
          );
          if (!delivered) throw new Error(`WebSocket reply delivery failed: ${inbound.connectionId}`);
          return;
        }
        const delivered = await sendToConnectionConfirmed(
          inbound.connectionId,
          serializeEnvelopeReplyFrame(payload, { sessionKey, messageId: inbound.messageId }),
          config.limits.maxBufferedBytes,
          config.limits.sendTimeoutMs,
        );
        if (!delivered) throw new Error(`WebSocket reply delivery failed: ${inbound.connectionId}`);
      },
      outboundFormat,
      replyRoute: { connectionId: inbound.connectionId },
      agentId,
    },
  });
}
