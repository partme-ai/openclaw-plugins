/**
 * 高德渠道 CLI 引导（Onboarding / Setup Wizard）
 *
 * **架构角色**：为 `openclaw setup` 提供声明式向导，引导用户配置
 * 高德 Web 服务 API Key 并写入 `channels.amap`。
 *
 * **关键依赖**：
 * - `./channel-setup-factory` — 通用 Channel setup 工厂
 * - `openclaw/plugin-sdk` — OpenClawConfig 类型
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { createSimpleChannelSetup, getChannelSection } from "./channel-setup-factory.js";

const CHANNEL_ID = "amap";

/**
 * 从 openclaw.json 解析指定账号的高德 API Key。
 *
 * 查找顺序：`channels.amap.accounts[accountId].key` → `channels.amap.key`。
 *
 * @param cfg - 当前 OpenClaw 配置
 * @param accountId - 账号 ID，默认 `"default"`
 * @returns API Key 字符串；未配置时返回 `undefined`
 */
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

/** 写入 channels.amap 配置的 setup adapter。 */
export const amapSetupAdapter = setupAdapter;

/** 交互式 CLI setup wizard 定义。 */
export const amapSetupWizard = setupWizard;
