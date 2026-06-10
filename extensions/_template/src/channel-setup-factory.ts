/**
 * 通道 setup 工厂：集中声明 setupAdapter / setupWizard，避免散落在 channel.ts。
 */

import { CHANNEL_ID } from "./config.js";

/** 最小 setupAdapter 占位（复杂渠道可替换为 openclaw/plugin-sdk/setup 工厂）。 */
export const templateSetupAdapter = {
  resolveAccountId: ({ accountId }: { accountId?: string }) => accountId?.trim() || "default",
  applyAccountConfig: ({ cfg }: { cfg: unknown }) => cfg,
  validateInput: () => null,
};

/** 最小 setupWizard 占位。 */
export const templateSetupWizard = {
  channel: CHANNEL_ID,
  intro: ["TEMPLATE_DESCRIPTION"],
  textInputs: [],
};
