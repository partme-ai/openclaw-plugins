/**
 * @fileoverview 小红书 Rednode Ark Open API 的签名客户端与调用边界。
 *
 * 只允许调用配置白名单中的 operation，严格替换路径参数并规范查询参数，按 Ark 规则生成
 * MD5 请求签名。客户端同时限制请求/响应大小、请求频率和网络超时，且不会把 appSecret
 * 拼入 URL 或错误信息。
 */
import { createHash } from "node:crypto";
import { safeRednodeError } from "../shared/safe-error.js";
import type {
  RednodeApiResponse,
  RednodeOperation,
  RednodePluginConfig,
} from "../types.js";

type RednodeClientDependencies = {
  fetch: typeof globalThis.fetch;
  now: () => number;
  random: () => number;
  sleep: (delayMs: number) => Promise<void>;
};

const DEFAULT_DEPENDENCIES: RednodeClientDependencies = {
  fetch: (...args) => globalThis.fetch(...args),
  now: Date.now,
  random: Math.random,
  sleep: (delayMs) =>
    new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    }),
};

/** Rednode 调用失败的统一错误，`code` 保存平台返回的业务错误码。 */
export class RednodeApiError extends Error {
  constructor(
    message: string,
    readonly code?: string | number,
  ) {
    super(message);
    this.name = "RednodeApiError";
  }
}

/** 执行白名单 Ark operation、签名请求并校验响应的共享客户端。 */
export class RednodeClient {
  private readonly operations = new Map<string, RednodeOperation>();
  private readonly requestTimestamps: number[] = [];
  private readonly dependencies: RednodeClientDependencies;

  constructor(
    private readonly config: RednodePluginConfig,
    dependencies: Partial<RednodeClientDependencies> = {},
  ) {
    this.dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencies };
    for (const operation of config.operations)
      this.operations.set(operation.name, operation);
  }

  getOperation(name: string): RednodeOperation | undefined {
    return this.operations.get(name);
  }

  async invoke(params: {
    operation: string;
    pathParams?: Record<string, unknown>;
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
  }): Promise<RednodeApiResponse> {
    const operation = this.operations.get(params.operation);
    if (!operation)
      throw new RednodeApiError(
        `Unknown or disallowed Rednode operation: ${params.operation}`,
      );
    const path = resolvePath(operation.apiPath, params.pathParams ?? {});
    const query = normalizeQuery(params.query ?? {});
    const bodyJson =
      operation.method === "GET"
        ? undefined
        : JSON.stringify(params.body ?? {});
    if (bodyJson && Buffer.byteLength(bodyJson) > this.config.maxRequestBytes)
      throw new RednodeApiError(
        "Rednode request body exceeded maxRequestBytes",
      );
    const url = new URL(path, `${this.config.apiBaseUrl}/`);
    for (const [key, value] of Object.entries(query).sort(([a], [b]) =>
      a.localeCompare(b),
    ))
      url.searchParams.set(key, value);
    if (Buffer.byteLength(url.toString()) > this.config.maxRequestBytes) {
      throw new RednodeApiError("Rednode request URL exceeded maxRequestBytes");
    }

    const response = await this.request(operation, url, bodyJson);
    const text = await readBoundedBody(response, this.config.maxResponseBytes);
    if (!response.ok)
      throw new RednodeApiError(`Rednode API HTTP ${response.status}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new RednodeApiError("Rednode API returned invalid JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new RednodeApiError(
        "Rednode API returned an invalid response object",
      );
    const result = parsed as RednodeApiResponse;
    // Ark 官方信封明确要求 Boolean；缺失或字符串值不能被静默当作成功。
    if (typeof result.success !== "boolean") {
      throw new RednodeApiError("Rednode API response is missing a boolean success field");
    }
    if (!result.success) {
      const errorCode =
        typeof result.error_code === "string" || typeof result.error_code === "number"
          ? result.error_code
          : undefined;
      throw new RednodeApiError(
        `Rednode API rejected the request: ${safeExternalMessage(result.error_msg, this.config)}`,
        errorCode,
      );
    }
    return result;
  }

  /**
   * 发起 Ark HTTP 请求。只有 GET 会对网络异常和官方列出的 500/502 临时错误重试；
   * POST/PUT 缺少服务端幂等键，任何自动重试都可能重复上下架、发货或更新操作。
   */
  private async request(
    operation: RednodeOperation,
    url: URL,
    bodyJson: string | undefined,
  ): Promise<Response> {
    const maximumAttempts =
      operation.method === "GET" ? this.config.getRetryMaxAttempts : 1;
    let lastError: RednodeApiError | undefined;

    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      this.consumeRateLimit(this.dependencies.now());
      const timestamp = String(Math.floor(this.dependencies.now() / 1_000));
      const signatureParams = Object.fromEntries(url.searchParams.entries());
      const sign = signRednodeRequest(
        url.pathname,
        { ...signatureParams, "app-key": this.config.appKey, timestamp },
        this.config.appSecret,
      );

      try {
        const response = await this.dependencies.fetch(url, {
          method: operation.method,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json;charset=utf-8",
            "app-key": this.config.appKey,
            timestamp,
            sign,
            "User-Agent": "openclaw-rednode/2026.7.1",
          },
          body: bodyJson,
          signal: AbortSignal.timeout(this.config.requestTimeoutMs),
        });
        if (
          operation.method === "GET" &&
          (response.status === 500 || response.status === 502) &&
          attempt < maximumAttempts
        ) {
          await response.body?.cancel().catch(() => undefined);
          await this.waitBeforeRetry(attempt);
          continue;
        }
        return response;
      } catch (error) {
        lastError = toRequestError(error, this.config);
        if (operation.method !== "GET" || attempt >= maximumAttempts) {
          throw lastError;
        }
        await this.waitBeforeRetry(attempt);
      }
    }

    throw lastError ?? new RednodeApiError("Rednode API request failed");
  }

  /** 使用指数退避和双向抖动打散多 Gateway 同步重试。 */
  private async waitBeforeRetry(failedAttempt: number): Promise<void> {
    const exponential = Math.min(
      this.config.retryInitialDelayMs * 2 ** (failedAttempt - 1),
      this.config.retryMaxDelayMs,
    );
    const jitter =
      exponential *
      this.config.retryJitterRatio *
      (this.dependencies.random() * 2 - 1);
    await this.dependencies.sleep(
      Math.max(0, Math.round(exponential + jitter)),
    );
  }

  /** 单进程滑动窗口限流；每次真实 HTTP 尝试（包括 GET 重试）都计入配额。 */
  private consumeRateLimit(now = Date.now()): void {
    const cutoff = now - 60_000;
    while (
      this.requestTimestamps[0] !== undefined &&
      this.requestTimestamps[0] <= cutoff
    )
      this.requestTimestamps.shift();
    if (this.requestTimestamps.length >= this.config.maxRequestsPerMinute)
      throw new RednodeApiError("Rednode local request rate limit exceeded");
    this.requestTimestamps.push(now);
  }
}

/**
 * 按小红书 Ark 规则生成请求签名。
 * 参数先过滤空值、按名称排序并 URL 编码，再与路径及仅在内存中使用的 AppSecret 计算 MD5；
 * AppSecret 不会进入 URL、请求头或日志。
 */
export function signRednodeRequest(
  path: string,
  params: Record<string, string>,
  appSecret: string,
): string {
  const pairs = Object.entries(params)
    .filter(([, value]) => value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join("&");
  return createHash("md5")
    .update(`${path}?${pairs}${appSecret}`, "utf8")
    .digest("hex");
}

function toRequestError(
  error: unknown,
  config: RednodePluginConfig,
): RednodeApiError {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new RednodeApiError("Rednode API request timed out");
  }
  return new RednodeApiError(
    `Rednode API request failed: ${safeExternalMessage(error instanceof Error ? error.message : undefined, config)}`,
  );
}

/** 清洗不可信平台/网络错误；除真实配置值外，也遮蔽常见认证字段和 URL 用户信息。 */
function safeExternalMessage(
  value: unknown,
  config: RednodePluginConfig,
): string {
  return safeRednodeError(value, [config.appKey, config.appSecret]);
}

function resolvePath(
  template: string,
  values: Record<string, unknown>,
): string {
  const expected = new Set(
    Array.from(template.matchAll(/\{([^}]+)\}/g), (match) => match[1]!),
  );
  for (const key of Object.keys(values))
    if (!expected.has(key))
      throw new RednodeApiError(`Unexpected path parameter: ${key}`);
  return template.replaceAll(/\{([^}]+)\}/g, (_match, key: string) => {
    const value = values[key];
    if (
      (typeof value !== "string" && typeof value !== "number") ||
      (typeof value === "number" && !Number.isFinite(value)) ||
      !String(value).trim() ||
      String(value).length > 256 ||
      /[\u0000-\u001f\u007f]/u.test(String(value))
    ) {
      throw new RednodeApiError(`Missing or invalid path parameter: ${key}`);
    }
    return encodeURIComponent(String(value).trim());
  });
}

function normalizeQuery(
  values: Record<string, unknown>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key))
      throw new RednodeApiError(`Invalid query parameter name: ${key}`);
    if (value === undefined || value === null) continue;
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    )
      throw new RednodeApiError(`Invalid query parameter value: ${key}`);
    if (typeof value === "number" && !Number.isFinite(value))
      throw new RednodeApiError(`Invalid query parameter value: ${key}`);
    const normalized = String(value);
    if (normalized.length > 2048 || /[\u0000-\u001f\u007f]/u.test(normalized))
      throw new RednodeApiError(`Query parameter is too long: ${key}`);
    result[key] = normalized;
  }
  return result;
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new RednodeApiError("Rednode API response exceeded maxResponseBytes");
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
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RednodeApiError(
          "Rednode API response exceeded maxResponseBytes",
        );
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
