/**
 * @module reply/bundle
 *
 * OpenClaw 回复 dispatcher bundle 工厂（deliver + lifecycle + replyOptions）。
 *
 * **职责**：将通道 `deliver` 与 typing 生命周期钩子组合为
 * `dispatchReplyWithBufferedBlockDispatcher` 可直接使用的 bundle。
 *
 * **适用场景**：WeCom / Feishu hook 化时统一构造 dispatcherOptions 与 replyOptions。
 *
 * **关键导出**：`createReplyDispatcherBundle`、`ReplyDispatcherBundle`
 */

import {
  createTypingLifecycleHooks,
  type TypingLifecycleCallbacks,
} from "../lifecycle/typing-lifecycle.js";

/**
 * OpenClaw `dispatchReplyWithBufferedBlockDispatcher` 的 dispatcherOptions 子集。
 *
 * @property deliver - 实际投递函数（文本 / 媒体）
 * @property onError - Agent 回复失败回调
 * @property onIdle - 回复空闲回调
 * @property onCleanup - dispatcher 清理回调
 */
export interface ReplyDispatcherOptions {
  deliver: (
    payload: { text?: string; [key: string]: unknown },
    info?: { kind?: string },
  ) => void | Promise<void>;
  onError?: (err: unknown) => void | Promise<void>;
  onIdle?: () => void | Promise<void>;
  onCleanup?: () => void;
}

/**
 * `createReplyDispatcherBundle` 返回值。
 *
 * @property dispatcherOptions - 含 deliver 与 lifecycle 的标准 dispatcher 选项
 * @property replyOptions - 透传给 OpenClaw reply 层的额外选项
 */
export interface ReplyDispatcherBundle {
  dispatcherOptions: ReplyDispatcherOptions;
  replyOptions: Record<string, unknown>;
}

/**
 * `createReplyDispatcherBundle` 入参。
 *
 * @property deliver - 通道投递实现
 * @property lifecycle - 可选 typing / error / cleanup 回调
 * @property replyOptions - 可选 reply 层扩展选项
 */
export interface CreateReplyDispatcherBundleParams {
  deliver: ReplyDispatcherOptions["deliver"];
  lifecycle?: TypingLifecycleCallbacks;
  replyOptions?: Record<string, unknown>;
}

/**
 * 创建标准回复 dispatcher bundle（deliver + lifecycle 钩子 + replyOptions）。
 *
 * 内部通过 `createTypingLifecycleHooks` 将插件 lifecycle 规范为标准钩子，
 * 再与 deliver 一并写入 `dispatcherOptions`。
 *
 * @param params - deliver、lifecycle 与 replyOptions
 * @returns 可直接传入 OpenClaw dispatch 函数的 bundle
 *
 * @example
 * ```ts
 * const { dispatcherOptions, replyOptions } = createReplyDispatcherBundle({
 *   deliver: async (payload) => sendWecomMessage(payload),
 *   lifecycle: { onTypingIdle: () => stopTyping() },
 * });
 * await dispatchReplyWithBufferedBlockDispatcher({ dispatcherOptions, replyOptions, ... });
 * ```
 */
export function createReplyDispatcherBundle(
  params: CreateReplyDispatcherBundleParams,
): ReplyDispatcherBundle {
  const lifecycle = createTypingLifecycleHooks(params.lifecycle);

  return {
    dispatcherOptions: {
      deliver: params.deliver,
      onError: lifecycle.onError,
      onIdle: lifecycle.onIdle,
      onCleanup: lifecycle.onCleanup,
    },
    replyOptions: params.replyOptions ?? {},
  };
}
