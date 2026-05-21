/**
 * Gotify 渠道 setupWizard — Server URL + App Token 声明式 CLI 配置。
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { resolveGotifyAccount } from "./config.js";
import { createSimpleChannelSetup } from "./channel-setup-factory.js";

const CHANNEL_ID = "gotify";

/**
 * 判断 Gotify 账号是否已配置 serverUrl 与 appToken。
 */
function isGotifyConfigured(cfg: OpenClawConfig, accountId?: string): boolean {
  const account = resolveGotifyAccount(cfg as Record<string, unknown>, accountId ?? null);
  return account.configured;
}

const { setupAdapter, setupWizard } = createSimpleChannelSetup({
  channel: CHANNEL_ID,
  label: "Gotify",
  docsPath: "/channels/gotify",
  resolveConfigured: isGotifyConfigured,
  introLines: [
    "Gotify 是自托管推送通知服务。",
    "需要 Server URL 与 Application Token（REST 发送 + Stream 接收）。",
  ],
  completionLines: [
    "Gotify 凭据已保存。",
    "可选：在配置中启用 bootstrap 自动创建 Application。",
    "运行 `openclaw gateway restart` 连接 Stream。",
  ],
  credentials: [
    {
      inputKey: "baseUrl",
      configKey: "serverUrl",
      label: "Server URL",
      preferredEnvVar: "GOTIFY_URL",
      inputPrompt: "Gotify 服务器地址（含协议与端口）",
      helpLines: ["示例：https://gotify.example.com"],
      getValue: (cfg, accountId) => {
        const account = resolveGotifyAccount(cfg as Record<string, unknown>, accountId ?? null);
        return account.serverUrl ?? undefined;
      },
    },
    {
      inputKey: "appToken",
      configKey: "appToken",
      label: "App Token",
      preferredEnvVar: "GOTIFY_APP_TOKEN",
      inputPrompt: "Gotify Application Token",
      getValue: (cfg, accountId) => {
        const account = resolveGotifyAccount(cfg as Record<string, unknown>, accountId ?? null);
        return account.appToken ?? undefined;
      },
    },
  ],
});

export const gotifySetupAdapter = setupAdapter;
export const gotifySetupWizard = setupWizard;
