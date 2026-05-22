/**
 * RocketMQ 出站适配器。
 * Agent 回复通过 Producer 发送到目标 Topic。
 */

import type { ChannelOutboundAdapter, ChannelOutboundContext } from "openclaw/plugin-sdk";
import { DEFAULT_ROCKERMQ_CONFIG } from "./config.js";
import { getRockermqChannelConfig } from "./state.js";
import { getPeerIdBySession, getSessionContext } from "./routing/session-mapper.js";
import { buildOutboundTopic } from "./routing/topic-router.js";

/**
 * 发送 OpenClaw 文本回复到 RocketMQ。
 */
export const rockermqOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  textChunkLimit: 4000,
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
    const { publishMessage } = await import("./transport/server.js");
    const receipt = await publishMessage({
      topic,
      tag: sessionContext.replyTag,
      payload: JSON.stringify({ text: ctx.text }),
    });
    return {
      channel: "rocketmq",
      messageId: String((receipt as { messageId?: unknown })?.messageId ?? sessionKey),
    };
  },
};
