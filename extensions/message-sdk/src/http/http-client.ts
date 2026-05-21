/**
 * HTTP 客户端 + 重试策略
 *
 * 来源：openclaw-china packages/shared/src/http/
 */

// ============================================================================
// 类型
// ============================================================================

export interface HttpRequestOptions {
  timeout?: number;
  headers?: Record<string, string>;
}

export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

// ============================================================================
// 错误
// ============================================================================

export class HttpError extends Error {
  constructor(message: string, public readonly status: number, public readonly body?: string) {
    super(message);
    this.name = "HttpError";
  }
}

export class TimeoutError extends Error {
  constructor(message: string, public readonly timeoutMs: number) {
    super(message);
    this.name = "TimeoutError";
  }
}

// ============================================================================
// HTTP 方法
// ============================================================================

export async function httpPost<T = unknown>(url: string, body: unknown, options?: HttpRequestOptions): Promise<T> {
  const { timeout = 30000, headers = {} } = options ?? {};
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: controller.signal });
    if (!response.ok) {
      const responseBody = await response.text().catch(() => "");
      throw new HttpError(`HTTP ${response.status}: ${response.statusText}`, response.status, responseBody);
    }
    return (await response.json()) as T;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new TimeoutError(`Request timeout after ${timeout}ms`, timeout);
    throw err;
  } finally { clearTimeout(timeoutId); }
}

export async function httpGet<T = unknown>(url: string, options?: HttpRequestOptions): Promise<T> {
  const { timeout = 30000, headers = {} } = options ?? {};
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { method: "GET", headers, signal: controller.signal });
    if (!response.ok) {
      const responseBody = await response.text().catch(() => "");
      throw new HttpError(`HTTP ${response.status}: ${response.statusText}`, response.status, responseBody);
    }
    return (await response.json()) as T;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new TimeoutError(`Request timeout after ${timeout}ms`, timeout);
    throw err;
  } finally { clearTimeout(timeoutId); }
}

// ============================================================================
// 重试
// ============================================================================

export function defaultShouldRetry(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === "TypeError" || error.name === "TimeoutError") return true;
    if ("status" in error && typeof (error as { status: number }).status === "number") {
      const status = (error as { status: number }).status;
      return status >= 500 && status < 600;
    }
  }
  return false;
}

function calcDelay(attempt: number, initial: number, max: number, mult: number): number {
  return Math.min(initial * Math.pow(mult, attempt - 1), max);
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

export async function withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
  const { maxRetries = 3, initialDelay = 1000, maxDelay = 10000, backoffMultiplier = 2, shouldRetry = defaultShouldRetry } = options ?? {};
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try { return await fn(); } catch (error) {
      lastError = error;
      if (attempt > maxRetries || !shouldRetry(error, attempt)) throw error;
      await sleep(calcDelay(attempt, initialDelay, maxDelay, backoffMultiplier));
    }
  }
  throw lastError;
}
