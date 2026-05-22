/**
 * 标准 typing 生命周期钩子（onError / onIdle / onCleanup）。
 */

/** 插件注入的 typing 回调。 */
export interface TypingLifecycleCallbacks {
  /** typing 指示器停止（错误或空闲时）。 */
  onTypingIdle?: () => void | Promise<void>;
  /** dispatcher 清理时调用。 */
  onCleanup?: () => void;
  /** Agent 回复失败时调用。 */
  onError?: (err: unknown) => void | Promise<void>;
}

/** 绑定到 OpenClaw dispatcherOptions 的标准钩子。 */
export interface TypingLifecycleHooks {
  onError: (err: unknown) => Promise<void>;
  onIdle: () => Promise<void>;
  onCleanup: () => void;
}

/**
 * 将插件 typing 回调规范为标准 dispatcher 生命周期钩子。
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
