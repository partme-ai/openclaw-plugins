/**
 * MQTT over WebSocket 渠道 setupWizard — 监听端口与路径配置。
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { createSimpleChannelSetup, getChannelSection } from "./channel-setup-factory.js";

const CHANNEL_ID = "mqtt-ws";

function isConfigured(cfg: OpenClawConfig): boolean {
  const section = getChannelSection(cfg, CHANNEL_ID);
  return Boolean(section.port && section.path);
}

const { setupAdapter, setupWizard } = createSimpleChannelSetup({
  channel: CHANNEL_ID,
  label: "MQTT over WebSocket",
  docsPath: "/channels/mqtt-ws",
  resolveConfigured: isConfigured,
  introLines: [
    "Web MQTT 在 Gateway 上暴露 WebSocket MQTT 端点，供浏览器与 Web 客户端接入。",
    "需配置监听端口与 WebSocket 路径（默认 15675 /ws）。",
  ],
  completionLines: [
    "MQTT over WebSocket 已写入配置。",
    "运行 `openclaw gateway restart` 启动 WS 服务。",
  ],
  textInputs: [
    {
      inputKey: "httpPort",
      configKey: "port",
      message: "WebSocket 监听端口",
      placeholder: "15675",
      getValue: (cfg) => {
        const v = getChannelSection(cfg, CHANNEL_ID).port;
        return v != null ? String(v) : undefined;
      },
    },
    {
      inputKey: "webhookPath",
      configKey: "path",
      message: "WebSocket 路径",
      placeholder: "/ws",
      getValue: (cfg) => {
        const v = getChannelSection(cfg, CHANNEL_ID).path;
        return typeof v === "string" ? v : undefined;
      },
    },
  ],
});

export const webMqttSetupAdapter = setupAdapter;
export const webMqttSetupWizard = setupWizard;
