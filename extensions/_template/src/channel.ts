// ChannelPlugin implementation
import type { ChannelPlugin } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID } from "./config.js";

export const plugin: ChannelPlugin = {
  id: "TEMPLATE_NAME",
  meta: {
    id: "TEMPLATE_NAME",
    label: "TEMPLATE_LABEL",
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
