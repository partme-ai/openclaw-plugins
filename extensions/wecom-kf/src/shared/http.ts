/**
 * @module shared/http
 *
 * 企微 KF 出站 HTTP 与超时工具（委托 message-sdk）。
 *
 * - `wecomFetch` / `readResponseBodyAsBuffer`：undici + 代理 + WeCom User-Agent
 * - `withTimeout` / `TimeoutError`：Promise 超时（保留历史 `TimeoutError` 名称）
 */

import {
  HttpError,
  undiciFetch as sdkUndiciFetch,
  readResponseBodyAsBuffer,
  withRetry,
  type UndiciFetchOptions,
} from "@partme.ai/openclaw-message-sdk/http";
import {
  withTimeout as sdkWithTimeout,
  AsyncTimeoutError,
} from "@partme.ai/openclaw-message-sdk/util";

export type WecomHttpOptions = UndiciFetchOptions & {
  /** 仅对无业务副作用的请求开启瞬态重试；发送消息等写操作必须保持 false。 */
  retrySafe?: boolean;
  /** 失败后的额外重试次数，范围 0..5。 */
  retries?: number;
  /** 首次重试等待时间，后续指数增长。 */
  retryDelayMs?: number;
};

/**
 * 统一 HTTP 请求（WeCom KF User-Agent 包装）。
 */
export async function wecomFetch(
  input: string | URL,
  init?: RequestInit,
  opts?: WecomHttpOptions,
): Promise<Response> {
  const {
    retrySafe = false,
    retries = 0,
    retryDelayMs = 500,
    ...fetchOptions
  } = opts ?? {};
  if (!Number.isInteger(retries) || retries < 0 || retries > 5) {
    throw new Error("wecom-kf network.retries must be an integer between 0 and 5");
  }
  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 30_000) {
    throw new Error("wecom-kf network.retryDelayMs must be an integer between 0 and 30000");
  }

  const execute = async (): Promise<Response> => {
    const response = await sdkUndiciFetch(input, init, {
      ...fetchOptions,
      userAgent: fetchOptions.userAgent ?? "OpenClaw/2.0 (WeCom-KF)",
    });
    if (retrySafe && retries > 0 && (response.status === 429 || response.status >= 500)) {
      // 重试前取消上一响应体，及时归还 undici 连接；错误中只保留状态码，不复述带 token 的 URL。
      await response.body?.cancel().catch(() => undefined);
      throw new HttpError(`WeCom KF transient HTTP ${response.status}`, response.status);
    }
    return response;
  };

  if (!retrySafe || retries === 0) return execute();
  return withRetry(execute, {
    maxRetries: retries,
    initialDelay: retryDelayMs,
    maxDelay: 30_000,
    backoffMultiplier: 2,
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
