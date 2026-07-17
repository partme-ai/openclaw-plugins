/**
 * @module mqtt/onboarding
 *
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

/** 将 CLI 输入转换为 `channels.mqtt` 配置补丁的声明式适配器。 */
export const mqttSetupAdapter = setupAdapter;
/** 引导用户启用内嵌 MQTT Broker 的 OpenClaw 配置向导。 */
export const mqttSetupWizard = setupWizard;
