/**
 * @module timeout
 *
 * 超时控制工具（委托 message-sdk util，保留 `TimeoutError` 名称兼容）。
 *
 * **职责**：为 Promise 包装超时竞态；WeCom 侧将 `AsyncTimeoutError` 映射为
 * 历史兼容的 `TimeoutError`（`instanceof TimeoutError` 判断仍有效）。
 *
 * **适用场景**：Agent reply dispatch、replyStream 发送、媒体下载等 I/O 边界。
 *
 * **关键导出**：`withTimeout`、`TimeoutError`
 */

import {
  withTimeout as sdkWithTimeout,
  AsyncTimeoutError,
} from "@partme.ai/openclaw-message-sdk/util";

/**
 * 超时错误（WeCom 历史兼容：`name` 为 `TimeoutError`）。
 *
 * 继承 message-sdk `AsyncTimeoutError`，便于 `catch (e instanceof TimeoutError)`。
 */
export class TimeoutError extends AsyncTimeoutError {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * 为 Promise 添加超时保护。
 *
 * @typeParam T - Promise 解析类型
 * @param promise - 待包装的 Promise
 * @param timeoutMs - 超时阈值（毫秒）
 * @param message - 超时错误消息（可选）
 * @returns 原 Promise 结果
 * @throws {TimeoutError} 超时
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message?: string,
): Promise<T> {
  return sdkWithTimeout(promise, timeoutMs, message).catch((err: unknown) => {
    if (err instanceof AsyncTimeoutError) {
      throw new TimeoutError(err.message);
    }
    throw err;
  });
}
