/**
 * @module lifecycle
 *
 * OpenClaw dispatcher 生命周期钩子（typing / error / idle / cleanup）的 barrel export。
 *
 * **职责**：将各 IM 插件注入的 typing 回调规范为 `dispatchReplyWithBufferedBlockDispatcher`
 * 所需的 `onError` / `onIdle` / `onCleanup` 标准钩子。
 *
 * **适用场景**：WeCom / Feishu 等在 Agent 回复期间展示「正在输入」，并在错误或空闲时停止指示器。
 *
 * **关键导出**：`createTypingLifecycleHooks`、`TypingLifecycleCallbacks`、`TypingLifecycleHooks`
 */

export {
  createTypingLifecycleHooks,
  type TypingLifecycleCallbacks,
  type TypingLifecycleHooks,
} from "./typing-lifecycle.js";
