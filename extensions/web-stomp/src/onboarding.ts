/**
 * STOMP over WebSocket 渠道 setupWizard — 内嵌 WS STOMP Bridge 配置。
 */

import { createEmbeddedBrokerChannelSetup } from "./channel-setup-factory.js";

const { setupAdapter, setupWizard } = createEmbeddedBrokerChannelSetup({
  channel: "stomp",
  label: "STOMP over WebSocket",
  docsPath: "/channels/stomp",
  introLines: [
    "Web STOMP 在 Gateway 上提供 STOMP over WebSocket 桥接。",
    "启用后 Agent 回复将推送到对应 session topic。",
  ],
});

export const stompWsSetupAdapter = setupAdapter;
export const stompWsSetupWizard = setupWizard;
