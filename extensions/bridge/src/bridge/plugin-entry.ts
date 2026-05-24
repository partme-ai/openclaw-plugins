/**
 * OpenClaw Bridge 插件定义（register 入口）。
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { registerContextInjection } from "./context-inject.js";
import { registerMessageBridge } from "./message-bridge.js";
import { ALL_CHANNELS } from "./channels.js";

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
