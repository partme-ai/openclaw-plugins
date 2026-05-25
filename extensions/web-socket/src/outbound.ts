/**
 * @module web-socket/outbound
 *
 * WebSocket 渠道出站：按 sessionKey 找到连接并推送 JSON 回复帧。
 */

import type {
  ChannelOutboundAdapter,
  ChannelOutboundContext,
} from "openclaw/plugin-sdk/channel-contract";
import { chunkText } from "openclaw/plugin-sdk/reply-runtime";
import { sanitizeForPlainText } from "openclaw/plugin-sdk/outbound-runtime";

import { DEFAULT_WEBSOCKET_CONFIG } from "./config.js";
import { serializeReplyFrame } from "./protocol.js";
import { getConnectionIdBySession, getSessionContext } from "./routing/session-mapper.js";
import { getWebsocketChannelConfig } from "./state/web-socket-state.js";
import { sendToConnection } from "./transport/connection-hub.js";

/**
 * OpenClaw ChannelOutboundAdapter：向 WebSocket 连接发送回复。
 */
export const webSocketOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: chunkText,
  chunkerMode: "text",
  textChunkLimit: 4000,
  sanitizeText: ({ text }) => sanitizeForPlainText(text),
  sendText: async (ctx: ChannelOutboundContext) => {
    const sessionKey = ctx.to;
    const connectionId = getConnectionIdBySession(sessionKey);
    if (!connectionId) {
      console.warn(`[openclaw-web-socket] No connection for session: ${sessionKey}`);
      return { channel: "web-socket", messageId: "no-connection" };
    }

    const sessionContext = getSessionContext(sessionKey);
    if (!sessionContext?.agentId) {
      console.error(`[openclaw-web-socket] Missing session context: ${sessionKey}`);
      return { channel: "web-socket", messageId: "no-session-context" };
    }

    const cfg = getWebsocketChannelConfig() ?? DEFAULT_WEBSOCKET_CONFIG;
    const frame =
      cfg.payload.outboundFormat === "plain"
        ? ctx.text
        : serializeReplyFrame(ctx.text, { sessionKey });

    const ok = sendToConnection(connectionId, frame);
    if (!ok) {
      console.warn(`[openclaw-web-socket] Send failed — socket closed: ${connectionId}`);
      return { channel: "web-socket", messageId: "socket-closed" };
    }

    console.log(`[openclaw-web-socket] Reply sent to ${connectionId}`);
    return { channel: "web-socket", messageId: sessionKey };
  },
};
