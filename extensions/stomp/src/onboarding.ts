/**
 * STOMP TCP 渠道 setupWizard — 内嵌 STOMP Broker 声明式 CLI 配置。
 */

import { createEmbeddedBrokerChannelSetup } from "./channel-setup-factory.js";

const { setupAdapter, setupWizard } = createEmbeddedBrokerChannelSetup({
  channel: "stomp-tcp",
  label: "STOMP TCP",
  docsPath: "/channels/stomp-tcp",
  introLines: [
    "STOMP TCP 插件提供原生 TCP STOMP Broker。",
    "启用后可在 channels.stomp-tcp 中配置端口、TLS 与 topic 绑定。",
  ],
});

export const stompTcpSetupAdapter = setupAdapter;
export const stompTcpSetupWizard = setupWizard;
