/**
 * @module web-socket/inbound
 *
 * WebSocket 入站：路由、message-sdk dispatch、回复经同一连接推送。
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
import { getWebsocketIdempotencyCache } from "./shared/wire-helpers.js";
import { getWebsocketChannelConfig } from "./state/web-socket-state.js";
import type { WebsocketInboundMessage } from "./types.js";
import { serializeReplyFrame } from "./protocol.js";
import { WS_CLIENT_CONNECTION_PREFIX } from "./transport/client.js";
import { sendToConnection } from "./transport/connection-hub.js";

const idempotencyCache = getWebsocketIdempotencyCache();

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
    console.warn(
      `[openclaw-web-socket] No agent route for connection=${message.connectionId}`,
    );
    sendToConnection(
      message.connectionId,
      JSON.stringify({
        type: "error",
        message: "No agent route: set defaultAgentId or agentBindings",
      }),
    );
    return;
  }

  const rt = getWebsocketRuntime();
  if (!rt) {
    console.warn("[openclaw-web-socket] Runtime not initialized");
    return;
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

  const idempotencyKey = message.messageId;
  const parsed = normalizeWireIngress({
    rawPayload: message.rawPayload,
    mode: config.payload.mode,
    channel: "web-socket",
    idempotencyKey,
    idempotency: idempotencyKey ? idempotencyCache : undefined,
  });
  if (!parsed.accepted) {
    console.log(`[openclaw-web-socket] Duplicate inbound dropped: ${message.messageId}`);
    return;
  }

  upsertSessionContext(sessionKey, {
    connectionId: message.connectionId,
    agentId,
    accountId: route.accountId,
  });

  const text = parsed.text;
  console.log(
    `[openclaw-web-socket] Inbound: connection=${message.connectionId}, peer=${peerId}, agent=${agentId}, session=${sessionKey}, source=${route.source}`,
  );

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
  } catch (error) {
    console.error(
      `[openclaw-web-socket] Dispatch failed connection=${message.connectionId}:`,
      error,
    );
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
    return;
  }

  const outboundFormat = config.payload.outboundFormat ?? "envelope";

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
          sendToConnection(inbound.connectionId, serializeReplyFrame(payload, { sessionKey }));
          return;
        }
        sendToConnection(inbound.connectionId, payload);
      },
      outboundFormat,
      replyRoute: { connectionId: inbound.connectionId },
      agentId,
    },
  });
}
