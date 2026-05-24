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
import plugin from "./bridge/plugin-entry.js";

// ── 渠道注册表 ──
export { ALL_CHANNELS, getChannelMeta, getExternalChannels, getBundledChannels } from "./bridge/channels.js";
export type { ChannelMeta, ChannelContextPreset } from "./bridge/channels.js";

// ── 渠道能力 ──
export { getChannelCapabilities, ALL_CAPABILITIES } from "./bridge/capabilities.js";
export type { ChannelCapabilities, SupportedFormat, MediaKind, MarkdownDialect, OverflowStrategy } from "./bridge/capabilities.js";

// ── 上下文预设 ──
export { PRESETS } from "./bridge/presets.js";

// ── 规范化 ──
export { normalizeForChannel, getChannelNormalizer, stripMarkdown, escapeMarkdownV2, convertToMrkdwn, splitText, stripAdvancedMarkdown } from "./bridge/normalize.js";
export type { NormalizedMessage, ChannelNormalizer } from "./bridge/normalize.js";

// ── 消息桥接 ──
export { deriveTraceId, generateMessageId, buildMessage } from "./bridge/message-bridge.js";
export type { UnifiedMessage } from "./bridge/message-bridge.js";

/** Base Profile 编排入口 — register(api) 委托至 bridge/plugin-entry。 */
export function register(api: OpenClawPluginApi): void {
  plugin.register(api);
}

export default plugin;
