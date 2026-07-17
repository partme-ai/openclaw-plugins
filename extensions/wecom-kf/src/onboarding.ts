/**
 * Base Profile onboarding 兼容入口；完整向导位于 `channel/onboarding.ts`。
 * 单一实现可避免 setup 与正式启动对账号字段使用不同默认值。
 */
export { wecomKfOnboardingAdapter } from "./channel/onboarding.js";
