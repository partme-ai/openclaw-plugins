/**
 * Zod schema for Redis Stream channel configuration.
 * Provides runtime validation and TypeScript type inference.
 */

import { z } from "zod";
import type { RedisChannelBinding, RedisChannelConfig } from "./types.js";

export type { RedisChannelBinding, RedisChannelConfig } from "./types.js";

/**
 * Zod schema for Redis channel binding configuration.
 */
const RedisChannelBindingSchema = z.object({
  channelPattern: z.string().min(1),
  agentId: z.string().min(1),
  accountId: z.string().default("default"),
  replyChannel: z.string().optional(),
});

/**
 * Zod schema for Redis Stream configuration.
 */
const StreamConfigSchema = z.object({
  inboundKey: z.string().default("openclaw:inbound"),
  outboundKey: z.string().default("openclaw:outbound"),
  consumerGroup: z.string().default("openclaw-group"),
  consumerName: z.string().default("openclaw-consumer-1"),
  blockMs: z.number().int().positive().default(5000),
  count: z.number().int().positive().default(10),
  createGroup: z.boolean().default(true),
});

/**
 * Zod schema for payload configuration.
 */
const RedisPayloadConfigSchema = z.object({
  mode: z.enum(["plain", "jsonTextOrPlain"]).default("jsonTextOrPlain"),
});

/**
 * Zod schema for field mapping configuration.
 */
const RedisFieldMappingSchema = z.object({
  textField: z.string().default("text"),
  agentIdField: z.string().default("agentId"),
  peerIdField: z.string().default("peerId"),
  accountIdField: z.string().default("accountId"),
  replyStreamField: z.string().default("replyStream"),
});

/**
 * Zod schema for connection configuration.
 */
const RedisConnectionConfigSchema = z.object({
  reconnectMs: z.number().int().positive().default(3000),
  maxRetries: z.number().int().positive().default(10),
});

/**
 * Complete Zod schema for Redis Stream channel configuration.
 */
export const RedisStreamConfigSchema = z.object({
  url: z.string().url().default("redis://localhost:6379"),
  channelMode: z.enum(["pubsub", "stream"]).default("pubsub"),
  defaultAgentId: z.string().default(""),
  stream: StreamConfigSchema,
  subscribeChannels: z.array(z.string()).default([]),
  channelBindings: z.array(RedisChannelBindingSchema).default([]),
  payload: RedisPayloadConfigSchema,
  fieldMapping: RedisFieldMappingSchema,
  connection: RedisConnectionConfigSchema,
});

/**
 * Type inference from Zod schema (matches RedisChannelConfig).
 */
export type RedisStreamConfigInput = z.input<typeof RedisStreamConfigSchema>;
export type RedisStreamConfigOutput = z.output<typeof RedisStreamConfigSchema>;

/**
 * JSON Schema representation of the Zod schema.
 * Can be used for validation documentation and UI generation.
 */
export const RedisStreamConfigJsonSchema: Record<string, unknown> = {
  type: "object",
  description: "Redis channel configuration for openclaw.json -> channels.redis-stream",
  additionalProperties: true,
  properties: {
    url: {
      type: "string",
      format: "uri",
      description: "Redis connection URL (e.g. redis://localhost:6379)",
      default: "redis://localhost:6379",
    },
    channelMode: {
      type: "string",
      enum: ["pubsub", "stream"],
      default: "pubsub",
      description:
        "Inbound mode: pubsub (Redis Pub/Sub channels) or stream (Redis Stream consumer group)",
    },
    defaultAgentId: {
      type: "string",
      default: "",
      description:
        "Fallback agent ID when no channel binding or standard format matches. Empty = skip unroutable messages.",
    },
    subscribeChannels: {
      type: "array",
      items: { type: "string" },
      default: [],
      description: "Redis channels/patterns to subscribe (supports * wildcard). Empty = accept all.",
    },
    channelBindings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          channelPattern: { type: "string", description: "Channel pattern (supports * wildcard)" },
          agentId: { type: "string", description: "Target agent ID" },
          accountId: { type: "string", description: "Account ID (default: \"default\")" },
          replyChannel: { type: "string", description: "Reply channel override" },
        },
        required: ["channelPattern", "agentId"],
      },
      default: [],
      description: "Explicit channel -> agent bindings (priority over standard format)",
    },
    stream: {
      type: "object",
      additionalProperties: false,
      properties: {
        inboundKey: { type: "string", default: "openclaw:inbound" },
        outboundKey: { type: "string", default: "openclaw:outbound" },
        consumerGroup: { type: "string", default: "openclaw-group" },
        consumerName: { type: "string", default: "openclaw-consumer-1" },
        blockMs: { type: "number", default: 5000 },
        count: { type: "number", default: 10 },
        createGroup: { type: "boolean", default: true },
      },
      default: {
        inboundKey: "openclaw:inbound",
        outboundKey: "openclaw:outbound",
        consumerGroup: "openclaw-group",
        consumerName: "openclaw-consumer-1",
        blockMs: 5000,
        count: 10,
        createGroup: true,
      },
    },
    payload: {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: {
          type: "string",
          enum: ["plain", "jsonTextOrPlain"],
          default: "jsonTextOrPlain",
          description: "Payload parsing mode",
        },
      },
      default: { mode: "jsonTextOrPlain" },
    },
    fieldMapping: {
      type: "object",
      additionalProperties: false,
      properties: {
        textField: { type: "string", default: "text" },
        agentIdField: { type: "string", default: "agentId" },
        peerIdField: { type: "string", default: "peerId" },
        accountIdField: { type: "string", default: "accountId" },
        replyStreamField: { type: "string", default: "replyStream" },
      },
      default: {
        textField: "text",
        agentIdField: "agentId",
        peerIdField: "peerId",
        accountIdField: "accountId",
        replyStreamField: "replyStream",
      },
    },
    connection: {
      type: "object",
      additionalProperties: false,
      properties: {
        reconnectMs: { type: "number", default: 3000 },
        maxRetries: { type: "number", default: 10 },
      },
      default: {
        reconnectMs: 3000,
        maxRetries: 10,
      },
    },
  },
  required: ["url"],
};

/**
 * Validate and parse a Redis Stream configuration object.
 * Throws if the input is invalid.
 */
export function validateRedisStreamConfig(input: unknown): RedisStreamConfigOutput {
  return RedisStreamConfigSchema.parse(input);
}

/**
 * Safely parse a Redis Stream configuration object.
 * Returns success result or error details.
 */
export function safeParseRedisStreamConfig(
  input: unknown
): { success: true; data: RedisStreamConfigOutput } | { success: false; error: z.ZodError } {
  return RedisStreamConfigSchema.safeParse(input);
}

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
 * 解析运行时 openclaw.json 中的 Redis channel 配置。
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
