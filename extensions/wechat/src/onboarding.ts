/**
 * 微信（Weixin）渠道 setupWizard — API Base URL 与登录引导。
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { DEFAULT_BASE_URL, listWeixinAccountIds } from "./auth/accounts.js";
import { createSimpleChannelSetup, getChannelSection } from "./channel-setup-factory.js";

const CHANNEL_ID = "openclaw-weixin";

function isWeixinConfigured(cfg: OpenClawConfig): boolean {
  return listWeixinAccountIds(cfg).length > 0;
}

const { setupAdapter, setupWizard } = createSimpleChannelSetup({
  channel: CHANNEL_ID,
  label: "微信",
  docsPath: "/channels/openclaw-weixin",
  resolveConfigured: isWeixinConfigured,
  introLines: [
    "微信渠道通过 iLink 长轮询接入，Token 保存在凭据文件中而非 openclaw.json。",
    "配置 Base URL 后请运行：`openclaw channels login --channel openclaw-weixin`",
  ],
  completionLines: [
    "Base URL 已写入配置。",
    "下一步：运行 `openclaw channels login --channel openclaw-weixin` 扫码登录。",
  ],
  textInputs: [
    {
      inputKey: "baseUrl",
      configKey: "baseUrl",
      message: "微信 API Base URL",
      placeholder: DEFAULT_BASE_URL,
      getValue: (cfg) => {
        const v = getChannelSection(cfg, CHANNEL_ID).baseUrl;
        return typeof v === "string" ? v : DEFAULT_BASE_URL;
      },
    },
  ],
});

export const weixinSetupAdapter = setupAdapter;
export const weixinSetupWizard = setupWizard;
