/**
 * MQTT 渠道 setupWizard — 内嵌 Aedes Broker 的声明式 CLI 配置。
 */

import { createEmbeddedBrokerChannelSetup } from "./channel-setup-factory.js";

const { setupAdapter, setupWizard } = createEmbeddedBrokerChannelSetup({
  channel: "mqtt",
  label: "MQTT",
  docsPath: "/channels/mqtt",
  introLines: [
    "MQTT 插件提供内嵌 Broker，适合 IoT 与设备接入。",
    "无需外部连接 URL；启用后可在 channels.mqtt 中调整端口、认证与 topic 绑定。",
  ],
});

export const mqttSetupAdapter = setupAdapter;
export const mqttSetupWizard = setupWizard;
