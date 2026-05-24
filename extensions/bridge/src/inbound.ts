/**
 * @fileoverview Bridge 入站侧「提示词构建前」上下文注入注册入口。
 *
 * @description
 * 门面模块：导出 `registerContextInjection`，供需要在独立路径挂载 Hook 注册的构建脚本引用；
 * 业务实现位于 `bridge/context-inject.ts`。
 *
 * @module inbound
 */

/**
 * Bridge 入站上下文注入 — Base Profile 入口。
 */

/** @description 注册 `before_prompt_build` 钩子，按渠道追加 `PRESETS` 系统上下文。 */
export { registerContextInjection } from "./bridge/context-inject.js";
