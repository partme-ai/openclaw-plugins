/**
 * @fileoverview RabbitMQ 出站适配器门面。
 *
 * @description
 * 将 Agent 文本回复发布到 reply Topic：通过 session-mapper 解析 peer 与会话上下文，
 * 再调用 transport 层 `publishMessage` 写入 Exchange。
 *
 * @module outbound
 */

import type {
  ChannelOutboundAdapter,
  ChannelOutboundContext,
} from "openclaw/plugin-sdk/channel-contract";
import { chunkText } from "openclaw/plugin-sdk/reply-runtime";
import { sanitizeForPlainText } from "openclaw/plugin-sdk/outbound-runtime";

import { publishMessage } from "./transport/server.js";
import { DEFAULT_RABBITMQ_CONFIG } from "./config.js";
import { getRabbitmqChannelConfig } from "./state/state.js";
import { getPeerIdBySession, getSessionContext } from "./routing/session-mapper.js";
import { buildOutboundTopic } from "./routing/topic-router.js";

/** @description OpenClaw ChannelOutboundAdapter：直连文本发布到 RabbitMQ Exchange。 */
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

    await publishMessage(outTopic, ctx.text);

    console.log(`[openclaw-rabbitmq] Reply published to ${outTopic} for peer ${peerId}`);
    return { channel: "rabbitmq", messageId: sessionKey };
  },
};
