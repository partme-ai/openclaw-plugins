/**
 * 美团渠道定义：注册到 OpenClaw 的 Channel，配置与出站占位
 */

import type { ChannelDefinition, MeituanAccountConfig } from "./types.js";
import { meituanSetupAdapter, meituanSetupWizard } from "./onboarding.js";
import { meituanSendText } from "./outbound.js";

export const meituanChannel: ChannelDefinition = {
  id: "meituan",
  meta: {
    id: "meituan",
    label: "美团",
    blurb: "美团开放平台渠道，支持订单/评价/经营数据与自动化运营",
    aliases: ["meituan", "美团"],
  },
  capabilities: {
    chatTypes: ["direct"],
  },
  setupWizard: meituanSetupWizard,
  setup: meituanSetupAdapter,
  config: {
    listAccountIds: (cfg) => {
      const channels = cfg.channels as Record<string, unknown> | undefined;
      const meituan = channels?.meituan as Record<string, unknown> | undefined;
      const accounts = meituan?.accounts as Record<string, unknown> | undefined;
      return accounts ? Object.keys(accounts) : ["default"];
    },
    resolveAccount: (cfg, accountId) => {
      const channels = cfg.channels as Record<string, Record<string, unknown>> | undefined;
      const meituan = channels?.meituan;
      const accounts = meituan?.accounts as Record<string, MeituanAccountConfig> | undefined;
      const id = accountId ?? "default";
      return (
        accounts?.[id] ??
        (meituan as unknown as MeituanAccountConfig) ??
        ({} as MeituanAccountConfig)
      );
    },
  },
  outbound: {
    deliveryMode: "direct",
    sendText: meituanSendText,
  },
};
