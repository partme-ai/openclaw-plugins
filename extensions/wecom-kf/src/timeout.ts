/**
 * 超时控制工具（委托 message-sdk util，保留 `TimeoutError` 名称兼容）。
 */
import {
  withTimeout as sdkWithTimeout,
  AsyncTimeoutError,
} from "@partme.ai/openclaw-message-sdk/util";

/**
 * 超时错误（历史兼容：`name` 为 `TimeoutError`）。
 */
export class TimeoutError extends AsyncTimeoutError {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * 为 Promise 添加超时保护。
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message?: string,
): Promise<T> {
  if (timeoutMs <= 0 || !Number.isFinite(timeoutMs)) {
    return promise;
  }
  return sdkWithTimeout(promise, timeoutMs, message).catch((err: unknown) => {
    if (err instanceof AsyncTimeoutError) {
      throw new TimeoutError(err.message);
    }
    throw err;
  });
}
