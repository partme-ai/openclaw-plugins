/**
 * 抖音渠道 setupWizard — App Key / App Secret 声明式 CLI 配置。
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
 * 解析抖音账号是否已配置（供 channel 状态展示复用）。
 */
export function isDouyinConfigured(cfg: OpenClawConfig, accountId?: string): boolean {
  return resolveDouyinAccount(cfg, accountId).configured;
}
