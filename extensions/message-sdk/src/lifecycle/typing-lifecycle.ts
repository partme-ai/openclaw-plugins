/**
 * @module lifecycle/typing-lifecycle
 *
 * OpenClaw dispatcher 标准 typing 生命周期钩子适配器。
 *
 * **职责**：将 IM 插件注入的 `onTypingIdle` / `onCleanup` / `onError` 回调
 * 规范为 `dispatchReplyWithBufferedBlockDispatcher` 所需的 `onError` / `onIdle` / `onCleanup`。
 *
 * **适用场景**：WeCom / Feishu 等在 Agent 流式回复期间展示「正在输入」，
 * 并在错误或空闲时停止 typing 指示器。
 *
 * **关键导出**：`createTypingLifecycleHooks`、`TypingLifecycleCallbacks`、`TypingLifecycleHooks`
 */

/**
 * 插件注入的 typing 与清理回调。
 *
 * @property onTypingIdle - typing 指示器停止（错误或空闲时）
 * @property onCleanup - dispatcher 清理时调用
 * @property onError - Agent 回复失败时调用
 */
export interface TypingLifecycleCallbacks {
  /** typing 指示器停止（错误或空闲时）。 */
  onTypingIdle?: () => void | Promise<void>;
  /** dispatcher 清理时调用。 */
  onCleanup?: () => void;
  /** Agent 回复失败时调用。 */
  onError?: (err: unknown) => void | Promise<void>;
}

/**
 * 绑定到 OpenClaw `dispatcherOptions` 的标准生命周期钩子。
 *
 * @property onError - 先调用插件 onError，再调用 onTypingIdle
 * @property onIdle - 空闲时停止 typing
 * @property onCleanup - 同步清理回调
 */
export interface TypingLifecycleHooks {
  onError: (err: unknown) => Promise<void>;
  onIdle: () => Promise<void>;
  onCleanup: () => void;
}

/**
 * 将插件 typing 回调规范为标准 dispatcher 生命周期钩子。
 *
 * @param callbacks - 可选插件回调；未提供时返回 no-op 钩子
 * @returns 可直接传入 `dispatcherOptions` 的标准钩子对象
 *
 * @example
 * ```ts
 * const lifecycle = createTypingLifecycleHooks({
 *   onTypingIdle: () => wecomApi.stopTyping(chatId),
 *   onError: (err) => log.error("reply failed", err),
 * });
 * dispatcherOptions: { ...lifecycle, deliver },
 * ```
 */
export function createTypingLifecycleHooks(
  callbacks?: TypingLifecycleCallbacks,
): TypingLifecycleHooks {
  return {
    onError: async (err: unknown) => {
      await callbacks?.onError?.(err);
      await callbacks?.onTypingIdle?.();
    },
    onIdle: async () => {
      await callbacks?.onTypingIdle?.();
    },
    onCleanup: () => {
      callbacks?.onCleanup?.();
    },
  };
}
