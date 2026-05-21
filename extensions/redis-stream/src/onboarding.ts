/**
 * Redis Stream 渠道 setupWizard — Redis URL 声明式 CLI 配置。
 */

import { createUrlChannelSetup } from "./channel-setup-factory.js";

const { setupAdapter, setupWizard } = createUrlChannelSetup({
  channel: "redis-stream",
  label: "Redis Stream",
  docsPath: "/channels/redis-stream",
  defaultUrl: "redis://127.0.0.1:6379",
  envVar: "REDIS_URL",
  introLines: [
    "Redis Stream 渠道支持 Pub/Sub 与 Stream 双模式。",
    "连接 URL 写入后可在配置中设置 stream key、consumer group 与 topic 绑定。",
  ],
});

export const redisStreamSetupAdapter = setupAdapter;
export const redisStreamSetupWizard = setupWizard;
