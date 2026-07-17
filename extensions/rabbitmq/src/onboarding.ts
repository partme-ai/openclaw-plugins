/**
 * RabbitMQ 渠道 setupWizard — 连接 URL 声明式 CLI 配置。
 */

import { createUrlChannelSetup } from "./channel-setup-factory.js";

const { setupAdapter, setupWizard } = createUrlChannelSetup({
  channel: "rabbitmq",
  label: "RabbitMQ",
  docsPath: "/channels/rabbitmq",
  defaultUrl: "amqp://localhost",
  envVar: "RABBITMQ_URL",
  introLines: [
    "RabbitMQ 渠道通过 AMQP URL 连接消息队列。",
    "配置 exchange、topic 绑定与 dispatch 模式请在 openclaw.json 中完善。",
  ],
});

/** 将 CLI 输入的 AMQP URL 写入 `channels.rabbitmq` 的声明式适配器。 */
export const rabbitmqSetupAdapter = setupAdapter;
/** 引导用户完成 RabbitMQ 基础连接配置的 OpenClaw 配置向导。 */
export const rabbitmqSetupWizard = setupWizard;
