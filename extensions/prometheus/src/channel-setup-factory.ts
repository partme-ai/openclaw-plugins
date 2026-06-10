/**
 * Prometheus setup 工厂占位（infra 插件无 Channel 向导步骤）。
 */

/** 最小 setupAdapter 占位。 */
export const prometheusSetupAdapter = {
  resolveAccountId: ({ accountId }: { accountId?: string }) => accountId?.trim() || "default",
  applyAccountConfig: ({ cfg }: { cfg: unknown }) => cfg,
  validateInput: () => null,
};

/** 最小 setupWizard 占位。 */
export const prometheusSetupWizard = {
  channel: "prometheus",
  intro: ["Prometheus metrics exporter for OpenClaw Gateway."],
  textInputs: [],
};
