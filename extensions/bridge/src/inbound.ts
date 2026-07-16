/**
 * @fileoverview Bridge 插件的入站上下文注入公共出口。
 *
 * `registerContextInjection` 负责在消息进入 Agent 前追加渠道能力与平台约束，本文件保持稳定
 * 导入路径，不重复承载具体注入逻辑。
 */
export { registerContextInjection } from "./bridge/context-inject.js";
