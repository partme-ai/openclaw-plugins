/**
 * @fileoverview RocketMQ 出站适配器：Agent 文本回复经 Producer 发送到 reply Topic。
 *
 * @description
 * 实现 OpenClaw Channel outbound 契约：`sendText` 根据 sessionKey 查 session-mapper
 * 中的 replyTopic/replyTag，经 transport `publishMessage` 写回 RocketMQ。
 *
 * @module outbound
 */

/**
 * RocketMQ 出站 — Base Profile 入口。
 */

import { serializeForTransport } from "@partme.ai/openclaw-message-sdk";

import { DEFAULT_ROCKERMQ_CONFIG } from "./config.js";
import { getRockermqChannelConfig } from "./state/state.js";
import { getPeerIdBySession, getSessionContext } from "./routing/session-mapper.js";
import { buildOutboundTopic } from "./routing/topic-router.js";

type ChannelOutboundContext = {
  to: string;
  text: string;
};

type ChannelOutboundAdapter = {
  deliveryMode: "direct";
  textChunkLimit?: number;
  sendText(ctx: ChannelOutboundContext): Promise<{ channel: string; messageId: string }>;
};

/**
 * @description RocketMQ Channel 出站适配器（direct 投递，4KB 文本分块上限）。
 */
export const rockermqOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  textChunkLimit: 4000,
  /**
   * @description 将 OpenClaw 文本回复发送到会话绑定的 reply Topic。
   * @param ctx - 出站上下文（`to` 为 sessionKey，`text` 为回复正文）。
   * @returns 渠道名与 messageId（或占位 id）。
   * @throws publish 失败时由 transport 层抛出。
   */
  async sendText(ctx: ChannelOutboundContext) {
    const sessionKey = ctx.to;
    const peerId = getPeerIdBySession(sessionKey);
    const sessionContext = getSessionContext(sessionKey);
    if (!sessionContext) {
      return { channel: "rocketmq", messageId: "no-session-context" };
    }

    const config = getRockermqChannelConfig() ?? DEFAULT_ROCKERMQ_CONFIG;
    const topic =
      sessionContext.replyTopic ??
      buildOutboundTopic(sessionContext.agentId, config.topicPrefix, peerId ?? undefined);
    const wire = serializeForTransport({
      channel: "rocketmq",
      accountId: sessionContext.accountId ?? "default",
      userId: peerId ?? sessionKey,
      text: ctx.text,
      agentId: sessionContext.agentId,
      format: "legacyJsonText",
    });
    const { publishMessage } = await import("./transport/server.js");
    const receipt = await publishMessage({
      topic,
      tag: sessionContext.replyTag,
      payload: wire,
    });
    return {
      channel: "rocketmq",
      messageId: String((receipt as { messageId?: unknown })?.messageId ?? sessionKey),
    };
  },
};
