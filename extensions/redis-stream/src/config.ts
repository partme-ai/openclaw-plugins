/**
 * Zod schema for Redis Stream channel configuration.
 * Provides runtime validation and TypeScript type inference.
 */

import { z } from "zod";
import type { RedisChannelConfig } from "./types.js";

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
