/**
 * 高德渠道 setupWizard — API Key 声明式 CLI 配置。
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { createSimpleChannelSetup, getChannelSection } from "./channel-setup-factory.js";

const CHANNEL_ID = "amap";

function resolveAmapKey(cfg: OpenClawConfig, accountId?: string): string | undefined {
  const section = getChannelSection(cfg, CHANNEL_ID);
  const accounts = section.accounts as Record<string, Record<string, unknown>> | undefined;
  const id = accountId ?? "default";
  const account = accounts?.[id] ?? section;
  const key = account.key;
  return typeof key === "string" ? key : undefined;
}

const { setupAdapter, setupWizard } = createSimpleChannelSetup({
  channel: CHANNEL_ID,
  label: "高德",
  docsPath: "/channels/amap",
  resolveConfigured: (cfg, accountId) => Boolean(resolveAmapKey(cfg, accountId)?.trim()),
  introLines: [
    "高德开放平台渠道用于 POI/周边/地理编码等 LBS 能力。",
    "在控制台创建应用后填入 Web 服务 API Key。",
  ],
  completionLines: ["高德 Key 已保存。", "可在 channels.amap 中配置 poi_id 与 callback_url。"],
  credentials: [
    {
      inputKey: "token",
      configKey: "key",
      label: "API Key",
      preferredEnvVar: "AMAP_KEY",
      inputPrompt: "高德 Web 服务 API Key",
      getValue: resolveAmapKey,
    },
  ],
});

export const amapSetupAdapter = setupAdapter;
export const amapSetupWizard = setupWizard;
