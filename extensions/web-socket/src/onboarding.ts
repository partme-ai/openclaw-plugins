/**
 * @module web-socket/onboarding
 *
 * WebSocket 渠道 setupWizard — 内嵌 ws 服务声明式配置。
 */

import { createEmbeddedBrokerChannelSetup } from "./channel-setup-factory.js";

const { setupAdapter, setupWizard } = createEmbeddedBrokerChannelSetup({
  channel: "web-socket",
  label: "WebSocket",
  docsPath: "/channels/web-socket",
  introLines: [
    "WebSocket 插件支持 client / server / both 三种模式。",
    "client：连外部 WS；server：内置 WS 服务；both：同时启用。",
    "可在 channels.web-socket 中配置 mode、url、端口与 defaultAgentId。",
  ],
});

export const webSocketSetupAdapter = setupAdapter;
export const webSocketSetupWizard = setupWizard;
