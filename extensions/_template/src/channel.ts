/**
 * ChannelPlugin 定义（通道契约层）。
 */

import type { ChannelPlugin } from "openclaw/plugin-sdk";

import { DEFAULT_ACCOUNT_ID } from "./config.js";
import { templateSetupAdapter, templateSetupWizard } from "./onboarding.js";

/**
 * 新渠道必须实现的最小 ChannelPlugin 样板。
 *
 * 生成插件时应替换占位符，并按真实协议修改 capabilities、账号配置和 Gateway 生命周期；
 * 不应把此处的 `configured: false` 或仅等待 abort 的启动逻辑直接当作生产实现。
 */
export const plugin: ChannelPlugin = {
  id: "TEMPLATE_NAME",
  meta: {
    id: "TEMPLATE_NAME",
    label: "TEMPLATE_LABEL",
    selectionLabel: "TEMPLATE_LABEL",
    docsPath: "/channels/TEMPLATE_NAME",
    blurb: "TEMPLATE_DESCRIPTION",
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    reactions: false,
    threads: false,
    nativeCommands: false,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.TEMPLATE_NAME"] },
  setupWizard: templateSetupWizard as never,
  setup: templateSetupAdapter as never,
  config: {
    listAccountIds: () => [DEFAULT_ACCOUNT_ID],
    resolveAccount: () => ({ accountId: DEFAULT_ACCOUNT_ID, enabled: true, configured: false }),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    isConfigured: () => false,
  },
  gateway: {
    startAccount: async (ctx) => {
      ctx.log?.info(`[TEMPLATE_NAME] starting account ${ctx.account.accountId}`);
      await new Promise((resolve) => {
        ctx.abortSignal.addEventListener("abort", () => resolve(undefined), { once: true });
      });
    },
  },
};
