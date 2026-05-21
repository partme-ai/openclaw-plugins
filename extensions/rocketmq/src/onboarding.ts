/**
 * RocketMQ 渠道 setupWizard — NameServer endpoints 声明式 CLI 配置。
 */

import { createUrlChannelSetup } from "./channel-setup-factory.js";

const { setupAdapter, setupWizard } = createUrlChannelSetup({
  channel: "rockermq",
  label: "RocketMQ",
  docsPath: "/channels/rockermq",
  urlField: "endpoints",
  defaultUrl: "127.0.0.1:8081",
  envVar: "ROCKETMQ_ENDPOINTS",
  introLines: [
    "RocketMQ 渠道通过 endpoints（NameServer 地址）接入。",
    "Producer/Consumer group 与 topic 绑定请在 openclaw.json 中继续配置。",
  ],
});

export const rockermqSetupAdapter = setupAdapter;
export const rockermqSetupWizard = setupWizard;
