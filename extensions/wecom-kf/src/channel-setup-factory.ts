/**
 * Base Profile 配置向导兼容入口，真实实现位于 `channel/onboarding.ts`。
 * setup 阶段只解析和校验配置，不建立企微客服长轮询连接。
 * @see Migration.md
 */
export {
  wecomKfOnboardingAdapter as wecomKfSetupWizard,
  wecomKfOnboardingAdapter as wecomKfSetupAdapter,
} from "./channel/onboarding.js";
