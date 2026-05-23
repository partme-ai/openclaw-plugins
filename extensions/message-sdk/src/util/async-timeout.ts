/**
 * @module util/async-timeout
 *
 * Promise 超时保护工具 / Promise timeout guard utilities.
 *
 * **职责**：为任意 Promise 附加超时竞态，超时后抛出 `AsyncTimeoutError`（与 HTTP 客户端
 * `TimeoutError` 区分，避免 catch 误判）。
 *
 * **适用场景**：Agent 回复、Webhook 回调、媒体下载等需要硬超时上限的异步操作。
 *
 * **上下游**：
 * - 上游：各通道插件 / dispatch / HTTP 客户端调用方
 * - 下游：无外部依赖，纯内存定时器
 *
 * **关键导出**：`withTimeout`、`AsyncTimeoutError`
 */

/**
 * 异步操作超时错误 / Error thrown when a Promise exceeds its timeout budget.
 */
export class AsyncTimeoutError extends Error {
  /**
   * @param message - 可读错误信息 / Human-readable timeout message
   */
  constructor(message: string) {
    super(message);
    this.name = "AsyncTimeoutError";
  }
}

/** @deprecated 使用 AsyncTimeoutError；保留别名供渠道插件迁移 */
export const TimeoutError = AsyncTimeoutError;

/**
 * 为 Promise 添加超时保护 / Race a Promise against a timeout timer.
 *
 * 当 `timeoutMs <= 0` 或非有限数时，直接返回原 Promise（不启用超时）。
 *
 * @param promise - 待保护的异步操作 / Promise to guard
 * @param timeoutMs - 超时毫秒数 / Timeout in milliseconds
 * @param message - 可选自定义超时错误文案 / Optional custom timeout message
 * @returns 原 Promise 结果，或超时后 reject `AsyncTimeoutError`
 * @throws {AsyncTimeoutError} 超过 `timeoutMs` 仍未 settle 时
 *
 * @example
 * ```ts
 * const result = await withTimeout(fetchData(), 30_000, "fetchData timed out");
 * ```
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message?: string,
): Promise<T> {
  // 无效或非正超时：透传原 Promise
  if (timeoutMs <= 0 || !Number.isFinite(timeoutMs)) {
    return promise;
  }

  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new AsyncTimeoutError(message ?? `Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}
