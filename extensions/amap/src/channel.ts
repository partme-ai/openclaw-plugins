/**
 * 高德渠道定义：注册到 OpenClaw 的 Channel，配置与出站占位
 */

import type { ChannelDefinition, AmapAccountConfig } from "./types.js";
import { amapSetupAdapter, amapSetupWizard } from "./onboarding.js";

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
    listAccountIds: (cfg) => {
      const channels = cfg.channels as Record<string, unknown> | undefined;
      const amap = channels?.amap as Record<string, unknown> | undefined;
      const accounts = amap?.accounts as Record<string, unknown> | undefined;
      return accounts ? Object.keys(accounts) : ["default"];
    },
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
    sendText: async () => ({ ok: true }),
  },
};
