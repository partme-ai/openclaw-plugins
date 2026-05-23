/**
 * Redis Stream / PubSub channel 出站适配：文本投递到 Stream 或 Pub/Sub。
 */

import { publishEntry, publishMessage } from "./transport/publisher.js";
import { resolveRedisChannelConfig } from "./config.js";

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
