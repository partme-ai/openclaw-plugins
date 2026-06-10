/**
 * @file Gotify onboarding — declarative CLI / UI setupWizard 编排。
 *
 * @description 通过 `createSimpleChannelSetup` factory 组装凭据字段、向导提示语与 finalize 钩子，
 * 并把 Server URL、App Token、Client Token patch 至 `channels.gotify`。
 * **模块角色**：Channel Plugin · Operator guided provisioning。
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { resolveGotifyAccount } from "./config.js";
import { createSimpleChannelSetup } from "./channel-setup-factory.js";

const CHANNEL_ID = "gotify";

/**
 * 判断账号是否具备 **最小出站组合**。
 *
 * @description `resolveGotifyAccount()` 推导 `configured`：`serverUrl` ∧ `appToken`。
 * @param cfg - OpenClaw 当前运行时配置快照。
 * @param accountId - 可选账号；缺省解析默认账号。
 * @returns `true` —— 出站路径可用（不代表 Stream / bootstrap 就绪）。
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

/**
 * Setup adapter —— Host 写入配置时调用的薄桥接层。
 *
 * @description 接收交互式输入生成的 patch，应用至 `channels.gotify[...]`，
 * 不负责启动 WebSocket（需 operator `gateway restart`）。
 */
export const gotifySetupAdapter = setupAdapter;
/**
 * Declarative wizard 元数据宿主对象。
 *
 * @description 提供给 OpenClaw UI/CLI：`status / intro / credentials / finalize / completion` 全链路。
 */
export const gotifySetupWizard = setupWizard;
