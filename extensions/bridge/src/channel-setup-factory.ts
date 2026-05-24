/**
 * Bridge 非 Channel 插件；保留 Base Profile setup 工厂占位。
 */

export const bridgeSetupAdapter = {
  resolveAccountId: ({ accountId }: { accountId?: string }) => accountId?.trim() || "default",
  applyAccountConfig: ({ cfg }: { cfg: unknown }) => cfg,
  validateInput: () => null,
};

export const bridgeSetupWizard = {
  channel: "bridge",
  intro: ["OpenClaw Bridge — 统一 IM 渠道适配层"],
  textInputs: [],
};
