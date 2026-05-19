/**
 * 小红书渠道定义：注册到 OpenClaw 的 Channel，配置与出站占位
 */

import type { ChannelDefinition, XhsAccountConfig } from "./types.js";

export const xhsChannel: ChannelDefinition = {
  id: "xhs",
  meta: {
    id: "xhs",
    label: "小红书",
    blurb: "小红书开放平台渠道，支持订单/售后/商品与自动化运营",
    aliases: ["xhs", "xiaohongshu", "小红书"],
  },
  capabilities: {
    chatTypes: ["direct"],
  },
  config: {
    listAccountIds: (cfg) => {
      const channels = cfg.channels as Record<string, unknown> | undefined;
      const xhs = channels?.xhs as Record<string, unknown> | undefined;
      const accounts = xhs?.accounts as Record<string, unknown> | undefined;
      return accounts ? Object.keys(accounts) : ["default"];
    },
    resolveAccount: (cfg, accountId) => {
      const channels = cfg.channels as Record<string, Record<string, unknown>> | undefined;
      const xhs = channels?.xhs;
      const accounts = xhs?.accounts as Record<string, XhsAccountConfig> | undefined;
      const id = accountId ?? "default";
      return (
        accounts?.[id] ??
        (xhs as unknown as XhsAccountConfig) ??
        ({} as XhsAccountConfig)
      );
    },
  },
  outbound: {
    deliveryMode: "direct",
    sendText: async () => ({ ok: true }),
  },
};
