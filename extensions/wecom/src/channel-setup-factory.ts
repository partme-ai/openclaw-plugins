/**
 * Base Profile 配置向导兼容入口，真实实现位于 `onboarding.ts`。
 * 该薄层只稳定 OpenClaw setup 导入路径，不应承载运行时副作用。
 * @see Migration.md
 */
export { wecomSetupWizard, wecomSetupAdapter } from "./onboarding.js";
