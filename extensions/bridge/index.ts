/**
 * OpenClaw Bridge — 统一 IM 渠道适配层
 *
 * 一个插件，覆盖所有 22 个 OpenClaw IM 渠道：
 * - 3 个外部官方（钉钉/飞书/QQ）— 需手动安装官方插件
 * - 19 个 bundled（WeCom/Discord/Slack/Telegram/WhatsApp...）— 随 OpenClaw 内置
 *
 * 功能：
 * 1. before_prompt_build — 按渠道注入平台特定的系统上下文
 * 2. agent_end — UnifiedMessage 消息桥接到 MQ
 * 3. 导出 normalizeForChannel / getChannelCapabilities / deriveTraceId 等供下游使用
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { registerContextInjection } from "./src/context-inject.js";
import { registerMessageBridge } from "./src/message-bridge.js";
import { ALL_CHANNELS } from "./src/channels.js";

// ── 渠道注册表 ──
export { ALL_CHANNELS, getChannelMeta, getExternalChannels, getBundledChannels } from "./src/channels.js";
export type { ChannelMeta, ChannelContextPreset } from "./src/channels.js";

// ── 渠道能力 ──
export { getChannelCapabilities, ALL_CAPABILITIES } from "./src/capabilities.js";
export type { ChannelCapabilities, SupportedFormat, MediaKind, MarkdownDialect, OverflowStrategy } from "./src/capabilities.js";

// ── 上下文预设 ──
export { PRESETS } from "./src/presets.js";

// ── 规范化 ──
export { normalizeForChannel, getChannelNormalizer, stripMarkdown, escapeMarkdownV2, convertToMrkdwn, splitText, stripAdvancedMarkdown } from "./src/normalize.js";
export type { NormalizedMessage, ChannelNormalizer } from "./src/normalize.js";

// ── 消息桥接 ──
export { deriveTraceId, generateMessageId, buildMessage } from "./src/message-bridge.js";
export type { UnifiedMessage } from "./src/message-bridge.js";

const plugin = {
  id: "openclaw-bridge",
  name: "OpenClaw Bridge",
  description:
    "统一 IM 渠道适配层 — 22 个渠道，一个插件（钉钉/飞书/QQ/Discord/Slack/Telegram/WhatsApp/...）",
  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      channels: {
        type: "object",
        additionalProperties: {
          type: "object",
          properties: {
            enabled: { type: "boolean", default: true },
            forwardToMq: { type: "boolean", default: true },
            mqChannel: { type: "string", default: "mqtt" },
            contextInjection: { type: "boolean", default: true },
          },
        },
      },
    },
  },
  register(api: OpenClawPluginApi) {
    api.logger.info(`[openclaw-bridge] Initializing — ${ALL_CHANNELS.length} channels available`);

    registerContextInjection(api);
    registerMessageBridge(api);

    api.logger.info("[openclaw-bridge] Ready");
  },
};

export default plugin;
