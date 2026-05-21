/**
 * 小红书（xhs）渠道 setupWizard — App Key / App Secret 声明式 CLI 配置。
 */

import { createAppKeySecretChannelSetup } from "./channel-setup-factory.js";

const { setupAdapter, setupWizard } = createAppKeySecretChannelSetup({
  channel: "xhs",
  label: "小红书",
  docsPath: "/channels/xhs",
  keyEnvVar: "XHS_APP_KEY",
  secretEnvVar: "XHS_APP_SECRET",
  introLines: [
    "小红书开放平台渠道用于订单、售后与商品运营。",
    "在开放平台控制台创建应用后填入凭据。",
  ],
});

export const xhsSetupAdapter = setupAdapter;
export const xhsSetupWizard = setupWizard;
