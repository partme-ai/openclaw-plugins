/**
 * HTTP 客户端 + 重试策略
 *
 * 来源：openclaw-china packages/shared/src/http/
 */

// ============================================================================
// 类型
// ============================================================================

/**
 * HttpRequestOptions 描述 http 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface HttpRequestOptions {
  timeout?: number;
  headers?: Record<string, string>;
}

/**
 * RetryOptions 描述 http 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
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

/**
 * HttpError 表示 http 模块中的可实例化能力。
 *
 * 类实例通常持有内存状态或错误语义；调用方应通过公开方法读取或更新状态，
 * 不要依赖内部字段布局。
 */
export class HttpError extends Error {
  constructor(message: string, public readonly status: number, public readonly body?: string) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * TimeoutError 表示 http 模块中的可实例化能力。
 *
 * 类实例通常持有内存状态或错误语义；调用方应通过公开方法读取或更新状态，
 * 不要依赖内部字段布局。
 */
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
 * httpPost 是 http 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
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
 * httpGet 是 http 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
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
 * defaultShouldRetry 是 http 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
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
 * withRetry 是 http 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
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
