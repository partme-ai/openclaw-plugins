/**
 * OpenClaw Gotify Channel — 配置 Schema 定义
 *
 * OpenClaw SDK 使用 Zod 作为配置校验格式（参见 buildChannelConfigSchema）。
 * 这里直接构建符合 ChannelConfigSchema 规范的 JSON Schema 对象，
 * 与 buildCatchallMultiAccountChannelSchema + buildChannelConfigSchema 等效。
 */

import { z } from "zod";

/**
 * OpenClaw 渠道配置 schema 容器。
 *
 * @property schema - JSON Schema 形式的配置结构，供宿主 UI/CLI 渲染和校验。
 * @property uiHints - 字段级 UI 元数据，例如 label、placeholder、secret 标记。
 */
export interface ChannelConfigSchema {
  schema: Record<string, unknown>;
  uiHints?: Record<string, ChannelConfigUiHint>;
}

/**
 * OpenClaw 配置 UI 的字段提示。
 *
 * @property label - 字段展示名。
 * @property description - 帮助说明。
 * @property placeholder - 输入框占位符。
 * @property secret - 是否按密钥字段处理，避免明文展示。
 */
export interface ChannelConfigUiHint {
  label?: string;
  description?: string;
  placeholder?: string;
  secret?: boolean;
  [key: string]: unknown;
}

/**
 * 单账号配置的 Zod Schema。
 *
 * 当前运行时主要消费下方 JSON Schema；保留 Zod Schema 是为了在未来迁移到
 * `buildCatchallMultiAccountChannelSchema` 时有可复用的强类型源。
 */
export const GotifyAccountSchema = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().optional(),
    serverUrl: z
      .string()
      .url("serverUrl must be a valid URL")
      .optional()
      .describe("Gotify server base URL (e.g. https://gotify.example.com)"),
    appToken: z
      .string()
      .min(1, "appToken is required for outbound delivery")
      .optional()
      .describe("Application token for sending messages"),
    clientToken: z
      .string()
      .optional()
      .describe("Client token for receiving messages and admin APIs"),
    defaultPriority: z
      .number()
      .int()
      .min(0)
      .max(10)
      .optional()
      .default(5)
      .describe("Default message priority (0-10, default 5)"),
    dmPolicy: z
      .enum(["open", "allowlist", "pairing", "disabled"])
      .optional()
      .default("open")
      .describe("DM access policy for inbound stream messages"),
    allowFrom: z
      .array(z.union([z.string(), z.number()]))
      .optional()
      .describe("Allowed appid/peerId entries when dmPolicy is allowlist"),
    inbound: z
      .object({
        enabled: z.boolean().optional().default(false),
        allowedAppId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Only accept inbound messages from this Gotify Application ID"),
        reconnectDelayMs: z.number().int().min(500).optional().default(2000),
        maxReconnectDelayMs: z
          .number()
          .int()
          .min(1000)
          .optional()
          .default(30_000),
        maxReconnectAttempts: z.number().int().min(0).optional().default(10),
        deleteAfterConsume: z
          .boolean()
          .optional()
          .default(true)
          .describe("Delete Gotify message after successful inbound dispatch"),
      })
      .strict()
      .optional(),
    bootstrap: z
      .object({
        enabled: z.boolean().optional().default(false),
        autoCreateApplication: z.boolean().optional().default(false),
        applicationName: z.string().optional().default("openclaw-default"),
        applicationDescription: z
          .string()
          .optional()
          .default("Provisioned by openclaw-gotify"),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * Gotify 渠道配置 Schema。
 * 等效于 buildCatchallMultiAccountChannelSchema(GotifyAccountSchema)
 * + buildChannelConfigSchema(..., { uiHints })。
 *
 * schema 允许顶层字段作为单账号配置，也允许 `accounts.<id>` 作为多账号配置。
 * appToken/clientToken 在 uiHints 中标记为 secret，确保配置界面不会明文回显。
 */
export const gotifyConfigSchema: ChannelConfigSchema = {
  schema: {
    type: "object",
    additionalProperties: true, // 允许账号任意扩展字段
    properties: {
      enabled: { type: "boolean" },
      name: { type: "string" },
      serverUrl: {
        type: "string",
        format: "uri",
        description: "Gotify server base URL",
      },
      appToken: {
        type: "string",
        minLength: 1,
        description: "Application token for sending messages",
      },
      clientToken: {
        type: "string",
        description: "Client token for receiving messages and admin APIs",
      },
      defaultPriority: {
        type: "integer",
        minimum: 0,
        maximum: 10,
        default: 5,
        description: "Default message priority (0-10)",
      },
      dmPolicy: {
        type: "string",
        enum: ["open", "allowlist", "pairing", "disabled"],
        default: "open",
        description: "DM access policy for inbound stream messages",
      },
      allowFrom: {
        type: "array",
        items: { type: ["string", "number"] },
        description: "Allowed appid/peerId when dmPolicy is allowlist",
      },
      inbound: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          allowedAppId: {
            type: "integer",
            minimum: 1,
            description:
              "Only accept inbound messages from this Gotify Application ID",
          },
          reconnectDelayMs: { type: "integer", minimum: 500 },
          maxReconnectDelayMs: { type: "integer", minimum: 1000 },
          maxReconnectAttempts: { type: "integer", minimum: 0 },
          deleteAfterConsume: {
            type: "boolean",
            default: true,
            description:
              "Delete message from Gotify after inbound is dispatched to the agent",
          },
        },
        additionalProperties: false,
      },
      bootstrap: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          autoCreateApplication: { type: "boolean" },
          applicationName: { type: "string" },
          applicationDescription: { type: "string" },
        },
        additionalProperties: false,
      },
      accounts: {
        type: "object",
        additionalProperties: true,
        description: "Multiple Gotify account configurations",
      },
      defaultAccount: {
        type: "string",
        description: "Default account ID when using multi-account mode",
      },
    },
    required: [], // 所有字段均为可选，由 resolveGotifyAccount 补充默认值
  },
  uiHints: {
    serverUrl: {
      label: "Gotify Server URL",
      description:
        "The base URL of your Gotify server (e.g. https://gotify.example.com)",
      placeholder: "https://gotify.example.com",
    },
    appToken: {
      label: "App Token",
      description:
        "Application token for sending messages (from Gotify Apps settings)",
      secret: true,
    },
    clientToken: {
      label: "Client Token",
      description:
        "Client token for receiving messages and admin APIs. Optional if only sending.",
      secret: true,
    },
    defaultPriority: {
      label: "Default Priority",
      description: "Message priority (0–10, default 5)",
    },
    "inbound.allowedAppId": {
      label: "Allowed Application ID",
      description:
        "Only receive inbound messages from this Gotify Application ID. Leave empty to receive all applications visible to the current user.",
      placeholder: "1",
    },
  },
};
