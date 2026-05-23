/**
 * @module http/http-client
 *
 * HTTP 客户端 + 指数退避重试策略。
 *
 * **职责**：JSON GET/POST 封装与可配置重试（网络错误、5xx）。
 *
 * **关键导出**：`httpGet`、`httpPost`、`withRetry`、`defaultShouldRetry`
 */

// ============================================================================
// 类型
// ============================================================================

/**
 * HTTP 请求选项 / Options for httpGet/httpPost.
 *
 * @property timeout - 超时毫秒（默认 30000）
 * @property headers - 额外请求头
 */
export interface HttpRequestOptions {
  timeout?: number;
  headers?: Record<string, string>;
}

/**
 * 重试策略选项 / Retry policy for {@link withRetry}.
 *
 * @property maxRetries - 最大重试次数（默认 3）
 * @property initialDelay - 首次退避毫秒（默认 1000）
 * @property maxDelay - 退避上限毫秒（默认 10000）
 * @property backoffMultiplier - 指数倍数（默认 2）
 * @property shouldRetry - 自定义是否重试（默认 {@link defaultShouldRetry}）
 */
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

/** HTTP 响应非 2xx / Non-success HTTP response with status and body snippet */
export class HttpError extends Error {
  constructor(message: string, public readonly status: number, public readonly body?: string) {
    super(message);
    this.name = "HttpError";
  }
}

/** 请求超时 / Request aborted due to timeout */
export class TimeoutError extends Error {
  constructor(message: string, public readonly timeoutMs: number) {
    super(message);
    this.name = "TimeoutError";
  }
}

// ============================================================================
// HTTP 方法
// ============================================================================

/**
 * POST JSON 并解析响应体为 JSON。
 *
 * @param url - 请求 URL
 * @param body - 将被 `JSON.stringify` 的请求体
 * @param options - 超时与请求头
 * @returns 解析后的 JSON（泛型 T）
 * @throws {@link HttpError} {@link TimeoutError}
 *
 * @example
 * ```ts
 * const data = await httpPost<{ id: string }>("https://api.example.com/items", { name: "a" });
 * ```
 */
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

/**
 * GET 并解析响应体为 JSON。
 *
 * @param url - 请求 URL
 * @param options - 超时与请求头
 * @returns 解析后的 JSON（泛型 T）
 * @throws {@link HttpError} {@link TimeoutError}
 */
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

/**
 * 默认重试判定：网络/超时错误与 5xx 响应可重试。
 *
 * @param error - 捕获的错误
 * @returns 是否应继续重试
 */
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

/**
 * 对异步函数执行指数退避重试。
 *
 * @param fn - 待执行的异步函数
 * @param options - 重试次数、退避与 shouldRetry 策略
 * @returns `fn` 成功时的返回值
 * @throws 超过重试次数或 shouldRetry 返回 false 时抛出最后一次错误
 *
 * @example
 * ```ts
 * const result = await withRetry(() => httpGet("https://api.example.com/health"), { maxRetries: 2 });
 * ```
 */
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
