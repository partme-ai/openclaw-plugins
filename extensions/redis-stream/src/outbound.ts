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

const DIRECT_TARGET_PREFIX = "openclaw-direct-topic:v1:";

function parseDirectTarget(value: string | undefined): string | null {
  if (!value?.startsWith(DIRECT_TARGET_PREFIX)) return null;
  const encoded = value.slice(DIRECT_TARGET_PREFIX.length);
  if (!encoded)
    throw new Error("[openclaw-redis-stream] Explicit direct target is empty");
  try {
    const target = decodeURIComponent(encoded);
    if (!target) throw new Error("empty target");
    return target;
  } catch (error) {
    throw new Error(
      `[openclaw-redis-stream] Invalid explicit direct target: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/** @description OpenClaw ChannelOutboundAdapter：按 channelMode 选择 Stream 或 Pub/Sub 出站。 */
export const redisStreamOutbound = {
  deliveryMode: "direct" as const,

  sendText: async (ctx: {
    cfg: Record<string, unknown>;
    text: string;
    to?: string;
    deliveryQueueId?: string;
  }) => {
    const config = resolveRedisChannelConfig(ctx.cfg);
    const directTarget = parseDirectTarget(ctx.to);
    if (directTarget && !ctx.deliveryQueueId) {
      throw new Error(
        "[openclaw-redis-stream] Explicit direct delivery requires deliveryQueueId",
      );
    }

    if (config.channelMode === "stream") {
      const id = await publishEntry(directTarget ?? config.stream.outboundKey, {
        [config.fieldMapping.textField]: ctx.text,
        ...(directTarget && ctx.deliveryQueueId
          ? { idempotencyKey: ctx.deliveryQueueId }
          : {}),
      });
      return { channel: "redis-stream", messageId: id };
    }

    const channel = directTarget ?? `openclaw:agent:outbound`;
    // Pub/Sub 的“命令已执行”不等于“消息已送达”。订阅者数量为 0 时消息不会被保留，
    // 必须显式失败，避免 Router/调用方把永久丢失误判成成功投递。
    const subscriberCount = await publishMessage(channel, ctx.text);
    if (subscriberCount === 0) {
      throw new Error(
        `[openclaw-redis-stream] No active subscriber for outbound channel: ${channel}`,
      );
    }
    return { channel: "redis-stream", messageId: `${channel}:${Date.now()}` };
  },
};
