/**
 * 美团渠道 CLI 引导（onboarding）配置。
 *
 * **架构角色**：基于 `createAppKeySecretChannelSetup` 生成声明式 wizard，
 * 引导用户配置 app_key / app_secret。
 *
 * **关键依赖**：`./channel-setup-factory`
 */

import { createAppKeySecretChannelSetup } from "./channel-setup-factory.js";

const { setupAdapter, setupWizard } = createAppKeySecretChannelSetup({
  channel: "meituan",
  label: "美团",
  docsPath: "/channels/meituan",
  keyEnvVar: "MEITUAN_APP_KEY",
  secretEnvVar: "MEITUAN_APP_SECRET",
  introLines: [
    "美团开放平台渠道用于订单、评价与经营数据接入。",
    "在美团开放平台创建应用后填入 app_key 与 app_secret。",
  ],
});

export const meituanSetupAdapter = setupAdapter;
export const meituanSetupWizard = setupWizard;
