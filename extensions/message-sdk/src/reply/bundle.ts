/**
 * Reply dispatcher bundle 类型壳（Phase 0 骨架，Phase 2 扩展 deliver 前处理）。
 */

import {
  createTypingLifecycleHooks,
  type TypingLifecycleCallbacks,
} from "../lifecycle/typing-lifecycle.js";

/** OpenClaw dispatchReplyWithBufferedBlockDispatcher 的 dispatcherOptions 子集。 */
export interface ReplyDispatcherOptions {
  deliver: (
    payload: { text?: string; [key: string]: unknown },
    info?: { kind?: string },
  ) => void | Promise<void>;
  onError?: (err: unknown) => void | Promise<void>;
  onIdle?: () => void | Promise<void>;
  onCleanup?: () => void;
}

/** createReplyDispatcherBundle 返回值。 */
export interface ReplyDispatcherBundle {
  dispatcherOptions: ReplyDispatcherOptions;
  replyOptions: Record<string, unknown>;
}

/** createReplyDispatcherBundle 入参。 */
export interface CreateReplyDispatcherBundleParams {
  deliver: ReplyDispatcherOptions["deliver"];
  lifecycle?: TypingLifecycleCallbacks;
  replyOptions?: Record<string, unknown>;
}

/**
 * 创建标准回复 dispatcher bundle（deliver + lifecycle 钩子 + replyOptions）。
 * Phase 0 为类型壳；WeCom hook 化时扩展 deliver 前处理链。
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
