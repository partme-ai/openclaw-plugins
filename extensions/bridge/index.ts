/**
 * OpenClaw Bridge — 统一 IM 渠道适配层
 *
 * 一个插件，覆盖所有 21 个 OpenClaw IM 渠道：
 * - 3 个外部官方（钉钉/飞书/QQ）— 需手动安装官方插件
 * - 18 个 bundled（Discord/Slack/Telegram/WhatsApp...）— 随 OpenClaw 内置
 *
 * 功能：
 * 1. before_prompt_build — 按渠道注入平台特定的系统上下文
 * 2. agent_end — UnifiedMessage 消息桥接到 MQ
 *
 * 配置驱动：默认只激活已配置的渠道。
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { registerContextInjection } from "./src/context-inject.js";
import { registerMessageBridge } from "./src/message-bridge.js";
import { ALL_CHANNELS } from "./src/channels.js";

const plugin = {
  id: "openclaw-bridge",
  name: "OpenClaw Bridge",
  description:
    "统一 IM 渠道适配层 — 21 个渠道，一个插件（钉钉/飞书/QQ/Discord/Slack/Telegram/WhatsApp/...）",
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
