/**
 * 插件模板 setupWizard — 新渠道插件可复制此文件并按 config 调整。
 */

import { createEmbeddedBrokerChannelSetup } from "./channel-setup-factory.js";

const CHANNEL_ID = "TEMPLATE_NAME";

const { setupAdapter, setupWizard } = createEmbeddedBrokerChannelSetup({
  channel: CHANNEL_ID,
  label: "TEMPLATE_LABEL",
  docsPath: "/channels/TEMPLATE_NAME",
  introLines: [
    "TEMPLATE_DESCRIPTION",
    "复制 wecom/src/onboarding.ts 或本文件，按 channels.TEMPLATE_NAME 配置 schema 定制凭据与 textInputs。",
  ],
});

export const templateSetupAdapter = setupAdapter;
export const templateSetupWizard = setupWizard;
