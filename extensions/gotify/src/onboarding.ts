/**
 * Gotify 渠道 setupWizard — Server URL + App Token 声明式 CLI 配置。
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { resolveGotifyAccount } from "./config.js";
import { createSimpleChannelSetup } from "./channel-setup-factory.js";

const CHANNEL_ID = "gotify";

/**
 * 判断 Gotify 账号是否已配置 serverUrl 与 appToken。
 *
 * @param cfg - OpenClaw 当前配置。
 * @param accountId - 可选账号 ID；为空时检查默认账号。
 * @returns true 表示账号具备最小出站配置。
 */
function isGotifyConfigured(cfg: OpenClawConfig, accountId?: string): boolean {
  const account = resolveGotifyAccount(
    cfg as Record<string, unknown>,
    accountId ?? null,
  );
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
    "入站 Stream 需配置 Client Token（channels.gotify.clientToken 或 GOTIFY_CLIENT_TOKEN）。",
    "可选：在配置中启用 bootstrap 自动创建 Application。",
    "运行 `openclaw gateway restart` 连接 Stream。",
  ],
  credentials: [
    /*
     * Gotify setup 采集三个字段：
     * - serverUrl：服务地址，不是密钥，但复用 credential 输入以获得环境变量提示。
     * - appToken：最小出站必需。
     * - clientToken：入站 stream 和 bootstrap/doctor 所需。
     */
    {
      inputKey: "baseUrl",
      configKey: "serverUrl",
      label: "Server URL",
      preferredEnvVar: "GOTIFY_SERVER_URL",
      inputPrompt: "Gotify 服务器地址（含协议与端口）",
      helpLines: ["示例：https://gotify.example.com"],
      getValue: (cfg, accountId) => {
        const account = resolveGotifyAccount(
          cfg as Record<string, unknown>,
          accountId ?? null,
        );
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
        const account = resolveGotifyAccount(
          cfg as Record<string, unknown>,
          accountId ?? null,
        );
        return account.appToken ?? undefined;
      },
    },
    {
      inputKey: "secret",
      configKey: "clientToken",
      label: "Client Token",
      preferredEnvVar: "GOTIFY_CLIENT_TOKEN",
      inputPrompt: "Gotify Client Token（WebSocket /stream 入站）",
      helpLines: ["在 Gotify WebUI → Clients 创建，前缀 C..."],
      getValue: (cfg, accountId) => {
        const account = resolveGotifyAccount(
          cfg as Record<string, unknown>,
          accountId ?? null,
        );
        return account.clientToken ?? undefined;
      },
    },
  ],
});

/** Gotify setup adapter，负责把 setup 输入 patch 到 `channels.gotify` 配置节。 */
export const gotifySetupAdapter = setupAdapter;
/** Gotify setup wizard，负责向 OpenClaw CLI/UI 暴露配置步骤与状态。 */
export const gotifySetupWizard = setupWizard;
