/**
 * 高德渠道定义（Channel Definition）
 *
 * **架构角色**：向 OpenClaw 注册 `amap` 渠道的元数据、账号配置解析、
 * CLI 引导（setupWizard / setup）及出站适配器。
 *
 * **关键依赖**：
 * - `./onboarding` — API Key 声明式 CLI 配置
 * - `./outbound` — 出站 sendText 占位（实际推送由平台 OpenAPI 完成）
 * - `./types` — 渠道与账号配置类型
 */

import type { ChannelDefinition, AmapAccountConfig } from "./types.js";
import { amapSetupAdapter, amapSetupWizard } from "./onboarding.js";
import { amapSendText } from "./outbound.js";

/**
 * 高德开放平台 Channel 完整定义。
 *
 * 支持 direct 会话类型；账号配置位于 `channels.amap` 或 `channels.amap.accounts.<id>`。
 */
export const amapChannel: ChannelDefinition = {
  id: "amap",
  meta: {
    id: "amap",
    label: "高德",
    blurb: "高德开放平台渠道，支持 POI/周边/地理编码与 LBS 运营",
    aliases: ["amap", "高德"],
  },
  capabilities: {
    chatTypes: ["direct"],
  },
  setupWizard: amapSetupWizard,
  setup: amapSetupAdapter,
  config: {
    /** 列出已配置的账号 ID；无 accounts 节时返回 `["default"]`。 */
    listAccountIds: (cfg) => {
      const channels = cfg.channels as Record<string, unknown> | undefined;
      const amap = channels?.amap as Record<string, unknown> | undefined;
      const accounts = amap?.accounts as Record<string, unknown> | undefined;
      return accounts ? Object.keys(accounts) : ["default"];
    },
    /**
     * 按 accountId 解析账号配置。
     * 回退顺序：accounts[id] → channels.amap 根节 → 空对象。
     */
    resolveAccount: (cfg, accountId) => {
      const channels = cfg.channels as Record<string, Record<string, unknown>> | undefined;
      const amap = channels?.amap;
      const accounts = amap?.accounts as Record<string, AmapAccountConfig> | undefined;
      const id = accountId ?? "default";
      return (
        accounts?.[id] ??
        (amap as unknown as AmapAccountConfig) ??
        ({} as AmapAccountConfig)
      );
    },
  },
  outbound: {
    deliveryMode: "direct",
    sendText: amapSendText,
  },
};
