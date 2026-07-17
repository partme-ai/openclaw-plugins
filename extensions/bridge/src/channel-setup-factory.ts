/**
 * Bridge 配置向导适配器。
 *
 * 向导本身不改写渠道配置，只复用运行态校验器提前报告错误，确保 setup 阶段与 Gateway
 * 启动阶段对同一份 BridgeConfig 得出一致结论。
 */
import { validateBridgeConfig, type BridgeConfig } from "./bridge/message-bridge.js";

/**
 * Bridge 的非交互式 setup 适配器。
 *
 * Bridge 没有独立账号凭据，因而只规范化 accountId 并原样保留根配置；`validateInput`
 * 复用启动期校验器，避免向导显示成功而 Gateway 随后因同一配置失败。
 */
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

/** Bridge setup UI 元数据；具体 channels/delivery 仍通过结构化配置完成。 */
export const bridgeSetupWizard = {
  channel: "bridge",
  intro: ["OpenClaw Bridge — IM context and MQ observation bridge"],
  textInputs: [],
};
