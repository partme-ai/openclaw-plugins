/**
 * 微信 iPad 协议渠道 setupWizard — iPad Bridge 服务地址配置。
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { DEFAULT_CONFIG } from "./types.js";
import { createSimpleChannelSetup, getChannelSection } from "./channel-setup-factory.js";

const CHANNEL_ID = "wechat-ipad";

function isWechatIpadConfigured(cfg: OpenClawConfig): boolean {
  const section = getChannelSection(cfg, CHANNEL_ID);
  return Boolean(String(section.serviceUrl ?? "").trim());
}

const { setupAdapter, setupWizard } = createSimpleChannelSetup({
  channel: CHANNEL_ID,
  label: "微信 (iPad 协议)",
  docsPath: "/channels/wechat-ipad",
  resolveConfigured: isWechatIpadConfigured,
  introLines: [
    "本插件桥接外部 iPad 协议服务（WebSocket + HTTP）。",
    "请先部署 iPad 协议服务，再填入 serviceUrl。",
  ],
  completionLines: [
    "iPad Bridge 地址已保存。",
    "启动 Gateway 后访问 GET /wechat-ipad/status 查看登录状态。",
  ],
  textInputs: [
    {
      inputKey: "baseUrl",
      configKey: "serviceUrl",
      message: "iPad 协议服务 WebSocket 地址",
      placeholder: DEFAULT_CONFIG.serviceUrl,
      getValue: (cfg) => {
        const v = getChannelSection(cfg, CHANNEL_ID).serviceUrl;
        return typeof v === "string" ? v : undefined;
      },
    },
    {
      inputKey: "url",
      configKey: "apiUrl",
      message: "iPad 协议 HTTP API 地址（可选）",
      placeholder: DEFAULT_CONFIG.apiUrl,
      required: false,
      getValue: (cfg) => {
        const v = getChannelSection(cfg, CHANNEL_ID).apiUrl;
        return typeof v === "string" ? v : undefined;
      },
    },
  ],
});

export const wechatIpadSetupAdapter = setupAdapter;
export const wechatIpadSetupWizard = setupWizard;
