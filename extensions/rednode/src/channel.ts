/**
 * @fileoverview 小红书（xhs）Channel 定义：多账户配置、Setup 向导与出站占位。
 *
 * @description
 * 实现 OpenClaw ChannelDefinition：config 解析 channels.xhs 多账户表，
 * outbound 委托 `xhsSendText` 占位实现。
 *
 * @module channel
 */

/**
 * Rednode xhs Channel — Base Profile 入口。
 */

import type { ChannelDefinition, XhsAccountConfig } from "./types.js";
import { xhsSetupAdapter, xhsSetupWizard } from "./onboarding.js";
import { xhsSendText } from "./outbound.js";

/** @description 导出的 xhs ChannelPlugin。 */
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
  setupWizard: xhsSetupWizard,
  setup: xhsSetupAdapter,
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
    sendText: xhsSendText,
  },
};
