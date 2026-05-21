/**
 * RabbitMQ 渠道出站适配器：将 Agent 回复发布到 RabbitMQ Topic。
 */

import type { ChannelOutboundAdapter, ChannelOutboundContext } from "openclaw/plugin-sdk";
import { chunkText, sanitizeForPlainText } from "./utils.js";

import { publishMessage } from "./rabbitmq-server.js";
import { DEFAULT_RABBITMQ_CONFIG } from "./rabbitmq-config.js";
import { getRabbitmqChannelConfig } from "./rabbitmq-state.js";
import { getPeerIdBySession, getSessionContext } from "./session-mapper.js";
import { buildOutboundTopic } from "./topic-router.js";

/**
 * OpenClaw ChannelOutboundAdapter：直连文本发布到 RabbitMQ。
 */
export const rabbitmqOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: chunkText,
  chunkerMode: "text",
  textChunkLimit: 4000,
  sanitizeText: ({ text }: { text: string }) => sanitizeForPlainText(text),
  sendText: async (ctx: ChannelOutboundContext) => {
    const sessionKey = ctx.to;
    const peerId = getPeerIdBySession(sessionKey);
    if (!peerId) {
      console.warn(`[openclaw-rabbitmq] Cannot send — no peer for session: ${sessionKey}`);
      return { channel: "rabbitmq", messageId: "no-peer" };
    }

    const sessionContext = getSessionContext(sessionKey);
    const agentId = sessionContext?.agentId;
    if (!agentId) {
      console.error(`[openclaw-rabbitmq] Cannot send — missing session context agentId: ${sessionKey}`);
      return { channel: "rabbitmq", messageId: "no-session-context" };
    }

    const cfg = getRabbitmqChannelConfig() ?? DEFAULT_RABBITMQ_CONFIG;
    const outTopic = sessionContext.replyTopic ?? buildOutboundTopic(agentId, cfg.topicPrefix, peerId);

    publishMessage(outTopic, ctx.text);

    console.log(`[openclaw-rabbitmq] Reply published to ${outTopic} for peer ${peerId}`);
    return { channel: "rabbitmq", messageId: sessionKey };
  },
};