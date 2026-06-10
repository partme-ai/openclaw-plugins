/**
 * @fileoverview Redis Stream/PubSub 出站适配器门面。
 *
 * @description
 * 将 Agent 文本投递至 Stream entry（`XADD`）或 Pub/Sub channel（`PUBLISH`），
 * 由 `channelMode` 决定传输路径。
 *
 * @module outbound
 */

import { publishEntry, publishMessage } from "./transport/publisher.js";
import { resolveRedisChannelConfig } from "./config.js";

/** @description OpenClaw ChannelOutboundAdapter：按 channelMode 选择 Stream 或 Pub/Sub 出站。 */
export const redisStreamOutbound = {
  deliveryMode: "direct" as const,

  sendText: async (ctx: { cfg: Record<string, unknown>; text: string }) => {
    const config = resolveRedisChannelConfig(ctx.cfg);

    if (config.channelMode === "stream") {
      const id = await publishEntry(config.stream.outboundKey, {
        [config.fieldMapping.textField]: ctx.text,
      });
      return { channel: "redis-stream", messageId: id };
    }

    const channel = `openclaw:agent:outbound`;
    await publishMessage(channel, ctx.text);
    return { channel: "redis-stream", messageId: `${channel}:${Date.now()}` };
  },
};
