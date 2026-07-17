/**
 * RocketMQ 渠道 setupWizard — NameServer endpoints 声明式 CLI 配置。
 */

import { createUrlChannelSetup } from "./channel-setup-factory.js";

const { setupAdapter, setupWizard } = createUrlChannelSetup({
  channel: "rocketmq",
  label: "RocketMQ",
  docsPath: "/channels/rocketmq",
  urlField: "endpoints",
  defaultUrl: "127.0.0.1:8081",
  envVar: "ROCKETMQ_ENDPOINTS",
  introLines: [
    "RocketMQ 渠道通过 endpoints（NameServer 地址）接入。",
    "Producer/Consumer group 与 topic 绑定请在 openclaw.json 中继续配置。",
  ],
});

/** 将 CLI 输入的 endpoints 写入 RocketMQ 渠道配置的声明式适配器。 */
export const rockermqSetupAdapter = setupAdapter;
/** 引导用户配置 RocketMQ NameServer endpoints 的 OpenClaw 配置向导。 */
export const rockermqSetupWizard = setupWizard;
