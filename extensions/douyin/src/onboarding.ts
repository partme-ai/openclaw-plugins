/**
 * 抖音渠道 CLI 引导（onboarding）配置。
 *
 * **架构角色**：声明式 setup wizard，引导用户写入 app_key / app_secret，
 * 与 `channel.ts` 中 `setup` / `setupWizard` 字段配对。
 *
 * **关键依赖**：`./channel-setup-factory`、`./config`
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { resolveDouyinAccount } from "./config.js";
import { createAppKeySecretChannelSetup } from "./channel-setup-factory.js";

const CHANNEL_ID = "douyin";

const { setupAdapter, setupWizard } = createAppKeySecretChannelSetup({
  channel: CHANNEL_ID,
  label: "抖音",
  docsPath: "/channels/douyin",
  keyEnvVar: "DOUYIN_APP_KEY",
  secretEnvVar: "DOUYIN_APP_SECRET",
  introLines: [
    "抖音开放平台 Webhook 入站需要 client_key（app_key）与 client_secret（app_secret）。",
    "在抖店/开放平台控制台创建应用后填入以下凭据。",
  ],
});

/** 渠道配置写入适配器（与 setupWizard 配对） */
export const douyinSetupAdapter = setupAdapter;

/** 声明式 setup wizard 配置 */
export const douyinSetupWizard = setupWizard;

/**
 * 判断抖音账号是否已具备有效凭据（供渠道状态展示复用）。
 *
 * @param cfg OpenClaw 全局配置
 * @param accountId 可选账号 id
 * @returns 当 app_key 与 app_secret 均非空时为 true
 */
export function isDouyinConfigured(cfg: OpenClawConfig, accountId?: string): boolean {
  return resolveDouyinAccount(cfg, accountId).configured;
}
