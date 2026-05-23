/**
 * @module shared/http
 *
 * 企微 KF 出站 HTTP 与超时工具（委托 message-sdk）。
 *
 * - `wecomFetch` / `readResponseBodyAsBuffer`：undici + 代理 + WeCom User-Agent
 * - `withTimeout` / `TimeoutError`：Promise 超时（保留历史 `TimeoutError` 名称）
 */

import {
  undiciFetch as sdkUndiciFetch,
  readResponseBodyAsBuffer,
  type UndiciFetchOptions,
} from "@partme.ai/openclaw-message-sdk/http";
import {
  withTimeout as sdkWithTimeout,
  AsyncTimeoutError,
} from "@partme.ai/openclaw-message-sdk/util";

export type WecomHttpOptions = UndiciFetchOptions;

/**
 * 统一 HTTP 请求（WeCom KF User-Agent 包装）。
 */
export async function wecomFetch(
  input: string | URL,
  init?: RequestInit,
  opts?: WecomHttpOptions,
): Promise<Response> {
  return sdkUndiciFetch(input, init, {
    ...opts,
    userAgent: opts?.userAgent ?? "OpenClaw/2.0 (WeCom-Agent)",
  });
}

export { readResponseBodyAsBuffer };

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
