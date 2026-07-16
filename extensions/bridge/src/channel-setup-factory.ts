import { validateBridgeConfig, type BridgeConfig } from "./bridge/message-bridge.js";

export const bridgeSetupAdapter = {
  resolveAccountId: ({ accountId }: { accountId?: string }) => accountId?.trim() || "default",
  applyAccountConfig: ({ cfg }: { cfg: unknown }) => cfg,
  validateInput: ({ config }: { config?: BridgeConfig } = {}) => {
    try {
      validateBridgeConfig(config ?? {});
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  },
};

export const bridgeSetupWizard = {
  channel: "bridge",
  intro: ["OpenClaw Bridge — IM context and MQ observation bridge"],
  textInputs: [],
};
