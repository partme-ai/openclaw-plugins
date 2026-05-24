/**
 * @module webhook/http-retry
 *
 * WeCom HTTP 出站重试分类与 `retryAsync` 封装。
 *
 * **职责**：仅对瞬态错误（网络失败、5xx、429）重试；永久 4xx、鉴权/签名/配置错误、
 * 企微 60020 IP 白名单等不重试。
 */

import { retryAsync } from "openclaw/plugin-sdk/retry-runtime";

/** 企微 API 明确不可重试的 errcode（IP 白名单、凭据无效等）。 */
export const WECOM_NON_RETRYABLE_ERRCODES = new Set([
  40001, // invalid secret
  40013, // invalid corpid
  40014, // invalid access_token
  40101, // missing access_token
  41001, // missing access_token (legacy)
  60020, // not allow to access from your ip
]);

/** 瞬态 HTTP 状态：429 与 5xx。 */
export function isTransientHttpStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * 从 Error 消息中解析企微 errcode（如 `send failed: 60020 not allow...`）。
 */
export function parseWeComErrcode(err: unknown): number | undefined {
  if (!(err instanceof Error)) return undefined;
  const match = err.message.match(/(?:errcode[=:\s]+|^|\s)(\d{4,6})(?:\s|$)/i);
  if (!match) return undefined;
  const code = Number.parseInt(match[1]!, 10);
  return Number.isFinite(code) ? code : undefined;
}

/**
 * 判断 HTTP 响应是否应触发重试（调用方需在收到响应后主动 throw 以进入 retry 循环）。
 */
export function shouldRetryWeComHttpResponse(res: Response): boolean {
  return isTransientHttpStatus(res.status);
}

/**
 * 判断 fetch 异常或业务错误是否可重试。
 */
export function shouldRetryWeComFetchError(err: unknown): boolean {
  const errcode = parseWeComErrcode(err);
  if (errcode !== undefined && WECOM_NON_RETRYABLE_ERRCODES.has(errcode)) {
    return false;
  }

  if (err instanceof WeComTransientHttpError) {
    return isTransientHttpStatus(err.status);
  }

  if (err instanceof Error) {
    if (err.name === "AbortError") return false;
    const msg = err.message.toLowerCase();
    if (msg.includes("invalid") && (msg.includes("token") || msg.includes("secret") || msg.includes("signature"))) {
      return false;
    }
    if (msg.includes("fetch failed") || msg.includes("network") || msg.includes("econnreset") || msg.includes("etimedout")) {
      return true;
    }
  }

  return false;
}

/** 标记瞬态 HTTP 状态，供 `retryAsync` 识别。 */
export class WeComTransientHttpError extends Error {
  constructor(
    public readonly status: number,
    message?: string,
  ) {
    super(message ?? `transient HTTP ${status}`);
    this.name = "WeComTransientHttpError";
  }
}

export type WeComRetryOptions = {
  attempts?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  label?: string;
};

const DEFAULT_RETRY: Required<Pick<WeComRetryOptions, "attempts" | "minDelayMs" | "maxDelayMs">> = {
  attempts: 3,
  minDelayMs: 250,
  maxDelayMs: 2_000,
};

/**
 * 对 WeCom HTTP 调用执行有限次瞬态重试。
 */
export async function retryWeComFetch<T>(
  fn: () => Promise<T>,
  options: WeComRetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_RETRY.attempts;
  const minDelayMs = options.minDelayMs ?? DEFAULT_RETRY.minDelayMs;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs;

  return retryAsync(fn, {
    attempts,
    minDelayMs,
    maxDelayMs,
    jitter: 0.2,
    label: options.label,
    shouldRetry: (err) => shouldRetryWeComFetchError(err),
  });
}
