/**
 * @fileoverview OpenClaw Bridge 插件聚合导出面（门面模块）。
 *
 * @description
 * 本文件位于插件包的公开 API 边界：对外统一导出渠道注册表、能力模型、上下文预设、
 * 出站规范化与 UnifiedMessage 桥接工具，并把 `register` 委托给 `bridge/plugin-entry`。
 * Base Profile / 宿主在加载插件时通常从本入口获取稳定符号，从而避免深层路径耦合。
 *
 * @module index
 */

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

/**
 * @description 将 Bridge 插件注册到 OpenClaw 宿主；实际逻辑委托给 `bridge/plugin-entry` 的默认导出。
 *
 * @param api - OpenClaw 插件 API（日志、配置、事件钩子等）。
 * @returns void
 * @throws 本函数不抛出同步异常；宿主内部初始化失败由宿主自行处理。
 */
export function register(api: OpenClawPluginApi): void {
  plugin.register(api);
}

/**
 * @description Bridge 插件默认导出对象（与 {@link register} 同源）。
 * @see ./bridge/plugin-entry.js
 */
export default plugin;
