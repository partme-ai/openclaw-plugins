/**
 * Redis Channel/Stream 配置与解析。
 */

import type { RedisChannelConfig, RedisChannelBinding } from "./types.js";

export type { RedisChannelConfig, RedisChannelBinding } from "./types.js";

/** 从 URL 中移除密码等敏感信息，避免泄露到日志或 HTTP 响应。 */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return url;
  }
}

export const DEFAULT_REDIS_CHANNEL_CONFIG: RedisChannelConfig = {
  url: "redis://127.0.0.1:6379",
  channelMode: "pubsub",
  defaultAgentId: "",
  stream: {
    inboundKey: "openclaw:inbound",
    outboundKey: "openclaw:outbound",
    consumerGroup: "openclaw-group",
    consumerName: "openclaw-consumer-1",
    blockMs: 5000,
    count: 10,
    createGroup: true,
  },
  subscribeChannels: [],
  channelBindings: [],
  payload: {
    mode: "jsonTextOrPlain",
  },
  fieldMapping: {
    textField: "text",
    agentIdField: "agentId",
    peerIdField: "peerId",
    accountIdField: "accountId",
    replyStreamField: "replyStream",
  },
  connection: {
    reconnectMs: 3000,
    maxRetries: 10,
  },
};

/**
 * 解析配置。
 */
export function resolveRedisChannelConfig(cfg: Record<string, unknown>): RedisChannelConfig {
  const channels = (cfg.channels as Record<string, unknown> | undefined) ?? {};
  const redisChannel = (channels["redis-stream"] as Record<string, unknown> | undefined) ?? {};
  const stream = (redisChannel.stream as Record<string, unknown> | undefined) ?? {};
  const fieldMapping = (redisChannel.fieldMapping as Record<string, unknown> | undefined) ?? {};
  const payload = (redisChannel.payload as Record<string, unknown> | undefined) ?? {};
  const connection = (redisChannel.connection as Record<string, unknown> | undefined) ?? {};

  const rawBindings = (
    Array.isArray(redisChannel.channelBindings)
      ? redisChannel.channelBindings
      : DEFAULT_REDIS_CHANNEL_CONFIG.channelBindings
  ) as Array<Record<string, unknown>>;

  const channelBindings: RedisChannelBinding[] = rawBindings
    .filter((b) => typeof b.channelPattern === "string" && typeof b.agentId === "string")
    .map((b) => ({
      channelPattern: String(b.channelPattern),
      agentId: String(b.agentId),
      ...(typeof b.accountId === "string" ? { accountId: String(b.accountId) } : {}),
      ...(typeof b.replyChannel === "string" ? { replyChannel: String(b.replyChannel) } : {}),
    }));

  const rawSubscribe = Array.isArray(redisChannel.subscribeChannels)
    ? redisChannel.subscribeChannels
    : DEFAULT_REDIS_CHANNEL_CONFIG.subscribeChannels;

  // 只保留字符串
  const subscribeChannels: string[] = (rawSubscribe as Array<unknown>).filter(
    (item): item is string => typeof item === "string",
  );

  const channelModeRaw = redisChannel.channelMode;
  const channelMode: "pubsub" | "stream" = channelModeRaw === "stream" ? "stream" : "pubsub";

  return {
    url: process.env.REDIS_URL || String(redisChannel.url ?? DEFAULT_REDIS_CHANNEL_CONFIG.url),
    channelMode,
    defaultAgentId:
      typeof redisChannel.defaultAgentId === "string"
        ? redisChannel.defaultAgentId
        : DEFAULT_REDIS_CHANNEL_CONFIG.defaultAgentId,
    stream: {
      inboundKey: String(stream.inboundKey ?? DEFAULT_REDIS_CHANNEL_CONFIG.stream.inboundKey),
      outboundKey: String(stream.outboundKey ?? DEFAULT_REDIS_CHANNEL_CONFIG.stream.outboundKey),
      consumerGroup: String(stream.consumerGroup ?? DEFAULT_REDIS_CHANNEL_CONFIG.stream.consumerGroup),
      consumerName: String(stream.consumerName ?? DEFAULT_REDIS_CHANNEL_CONFIG.stream.consumerName),
      blockMs:
        typeof stream.blockMs === "number" && stream.blockMs >= 0
          ? stream.blockMs
          : DEFAULT_REDIS_CHANNEL_CONFIG.stream.blockMs,
      count:
        typeof stream.count === "number" && stream.count > 0 ? stream.count : DEFAULT_REDIS_CHANNEL_CONFIG.stream.count,
      createGroup: stream.createGroup !== false,
    },
    subscribeChannels,
    channelBindings,
    payload: {
      mode:
        payload.mode === "plain" || payload.mode === "jsonTextOrPlain"
          ? payload.mode
          : DEFAULT_REDIS_CHANNEL_CONFIG.payload.mode,
    },
    fieldMapping: {
      textField: String(fieldMapping.textField ?? DEFAULT_REDIS_CHANNEL_CONFIG.fieldMapping.textField),
      agentIdField: String(fieldMapping.agentIdField ?? DEFAULT_REDIS_CHANNEL_CONFIG.fieldMapping.agentIdField),
      peerIdField: String(fieldMapping.peerIdField ?? DEFAULT_REDIS_CHANNEL_CONFIG.fieldMapping.peerIdField),
      accountIdField: String(fieldMapping.accountIdField ?? DEFAULT_REDIS_CHANNEL_CONFIG.fieldMapping.accountIdField),
      replyStreamField: String(
        fieldMapping.replyStreamField ?? DEFAULT_REDIS_CHANNEL_CONFIG.fieldMapping.replyStreamField,
      ),
    },
    connection: {
      reconnectMs:
        typeof connection.reconnectMs === "number" && connection.reconnectMs > 0
          ? connection.reconnectMs
          : DEFAULT_REDIS_CHANNEL_CONFIG.connection.reconnectMs,
      maxRetries:
        typeof connection.maxRetries === "number" && connection.maxRetries > 0
          ? connection.maxRetries
          : DEFAULT_REDIS_CHANNEL_CONFIG.connection.maxRetries,
    },
  };
}
