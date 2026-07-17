/**
 * @fileoverview Knowledge 外部 Provider 共用的有界 JSON HTTP 客户端。
 *
 * 每次尝试使用独立 AbortController，仅对网络错误、408/429 和 5xx 做有限指数退避；响应体
 * 通过流式读取执行字节上限，错误摘要会压平控制字符并隐藏常见凭据，避免 Provider 故障
 * 导致内存膨胀或秘密进入日志。
 */

import { safeKnowledgeError } from './safe-error.js';

export const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;
/** 外部 Provider 默认最多重试两次，仅覆盖临时性网络或服务端故障。 */
export const DEFAULT_PROVIDER_MAX_RETRIES = 2;
/** 默认响应体上限 8 MiB，防止异常服务无限返回导致进程内存膨胀。 */
export const DEFAULT_PROVIDER_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_PROVIDER_TIMEOUT_MS = 300_000;
const MAX_PROVIDER_RETRIES = 10;
const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024 * 1024;

/** 外部 Provider HTTP 调用的资源边界配置。 */
export type ProviderHttpOptions = {
  timeoutMs?: number;
  maxRetries?: number;
  maxResponseBytes?: number;
};

/** 使用超时、有限重试和响应上限请求外部 Provider JSON。 */
export async function requestProviderJson<T>(
  url: string,
  init: RequestInit,
  options: ProviderHttpOptions | undefined,
  provider: string,
  operation: string,
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  const maxRetries = options?.maxRetries ?? DEFAULT_PROVIDER_MAX_RETRIES;
  const maxResponseBytes = options?.maxResponseBytes ?? DEFAULT_PROVIDER_MAX_RESPONSE_BYTES;
  assertIntegerInRange(timeoutMs, 1, MAX_PROVIDER_TIMEOUT_MS, 'timeoutMs');
  assertIntegerInRange(maxRetries, 0, MAX_PROVIDER_RETRIES, 'maxRetries');
  assertIntegerInRange(maxResponseBytes, 1, MAX_PROVIDER_RESPONSE_BYTES, 'maxResponseBytes');
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
      const response = await fetch(url, { ...init, signal });
      const raw = await readResponseText(response, maxResponseBytes, provider, operation);
      if (!response.ok) {
        const error = new ProviderHttpStatusError(
          response.status,
          `${provider} ${operation} API error: ${response.status} ${response.statusText} — ${safeErrorText(raw)}`,
        );
        if (!isRetryableStatus(response.status) || attempt === maxRetries) throw error;
        lastError = error;
      } else {
        try {
          return JSON.parse(raw) as T;
        } catch (error) {
          throw new Error(`${provider} ${operation} API returned invalid JSON`, { cause: error });
        }
      }
    } catch (error) {
      lastError = error;
      // 调用方主动取消代表上游已经放弃本次工作，既不应伪装成 Provider 超时，也不应
      // 继续重试并制造额外外部副作用。只有本客户端自己的超时 Abort 才进入重试判断。
      if (init.signal?.aborted && error instanceof Error && error.name === 'AbortError') {
        throw new Error(`${provider} ${operation} request aborted by caller`, { cause: error });
      }
      if (attempt === maxRetries || !isRetryableError(error)) {
        throw normalizeError(error, provider, operation, timeoutMs);
      }
    } finally {
      clearTimeout(timer);
    }
    await delay(Math.min(250 * 2 ** attempt, 2_000));
  }
  throw normalizeError(lastError, provider, operation, timeoutMs);
}

/** 为无法接收 AbortSignal 的第三方 SDK Promise 添加调用方超时上限。 */
export async function withProviderTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  provider: string,
  operation: string,
): Promise<T> {
  assertIntegerInRange(timeoutMs, 1, MAX_PROVIDER_TIMEOUT_MS, 'timeoutMs');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${provider} ${operation} request timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 错误配置必须在发起网络请求前失败，避免负重试或零超时形成难以诊断的运行态。 */
function assertIntegerInRange(value: number, minimum: number, maximum: number, name: string): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Knowledge provider ${name} must be an integer between ${minimum} and ${maximum}`);
  }
}

class ProviderHttpStatusError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ProviderHttpStatusError";
  }
}

async function readResponseText(
  response: Response,
  maximumBytes: number,
  provider: string,
  operation: string,
): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`${provider} ${operation} response exceeds ${maximumBytes} bytes`);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`${provider} ${operation} response exceeds ${maximumBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isRetryableError(error: unknown): boolean {
  return error instanceof TypeError
    || (error instanceof Error && error.name === "AbortError")
    || (error instanceof ProviderHttpStatusError && isRetryableStatus(error.status));
}

function normalizeError(error: unknown, provider: string, operation: string, timeoutMs: number): Error {
  if (error instanceof Error && error.name === "AbortError") {
    return new Error(`${provider} ${operation} request timed out after ${timeoutMs}ms`);
  }
  return new Error(`${provider} ${operation} request failed: ${safeKnowledgeError(error)}`);
}

function safeErrorText(value: string): string {
  return safeKnowledgeError(value).slice(0, 2_048);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
  });
}
