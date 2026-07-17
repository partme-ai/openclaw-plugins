/**
 * 高德地点搜索 2.0 的受限 HTTP 客户端。
 *
 * 仅允许插件声明的三个 GET 路径；请求前执行进程内速率限制，响应实施大小和 JSON
 * 信封校验。只有 429/5xx 等读取型瞬时失败会有限重试，不提供任意 URL 调用能力。
 */
import { createHash } from "node:crypto";
import type { AmapApiResponse, AmapClientStatus, AmapPluginConfig } from "../types.js";

const ALLOWED_PATHS = new Set(["/v5/place/text", "/v5/place/around", "/v5/place/detail"]);
/**
 * 高德虽然用 HTTP 200 返回业务错误，但部分错误实际表示分钟/QPS 限流或网关瞬时故障。
 * 这里只重试官方错误码表中明确可短时恢复的错误；日配额、Key、权限和参数错误必须快速失败。
 */
const RETRYABLE_INFO_CODES = new Set(["10014", "10015", "10016", "10019", "10020", "10021"]);

/** 高德 HTTP、业务信封、配额和响应边界的统一错误类型。 */
export class AmapApiError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "AmapApiError";
  }
}

/**
 * 只允许地点搜索 2.0 三个 GET 接口的高德客户端。
 *
 * API Key 仅写入请求 URL，不进入返回值；客户端在进程内实施分钟级配额，并只对读取型
 * 瞬时故障进行有限重试，因此不会成为可访问任意高德或第三方路径的通用 HTTP 代理。
 */
export class AmapClient {
  private readonly requestTimestamps: number[] = [];
  private activeRequests = 0;
  private attemptsTotal = 0;
  private successfulInvocationsTotal = 0;
  private failedInvocationsTotal = 0;
  private concurrencyRejectedTotal = 0;
  private rateLimitRejectedTotal = 0;
  private lastSuccessAt: number | null = null;
  private lastErrorAt: number | null = null;
  private lastError: string | null = null;

  constructor(private readonly config: AmapPluginConfig) {}

  /** 返回同一进程内的低敏诊断状态，不暴露搜索词、坐标、响应正文和签名凭据。 */
  status(): AmapClientStatus {
    this.pruneRateLimitWindow(Date.now());
    return {
      activeRequests: this.activeRequests,
      maxConcurrentRequests: this.config.maxConcurrentRequests,
      requestsInCurrentWindow: this.requestTimestamps.length,
      maxRequestsPerMinute: this.config.maxRequestsPerMinute,
      attemptsTotal: this.attemptsTotal,
      successfulInvocationsTotal: this.successfulInvocationsTotal,
      failedInvocationsTotal: this.failedInvocationsTotal,
      concurrencyRejectedTotal: this.concurrencyRejectedTotal,
      rateLimitRejectedTotal: this.rateLimitRejectedTotal,
      lastSuccessAt: this.lastSuccessAt,
      lastErrorAt: this.lastErrorAt,
      lastError: this.lastError,
    };
  }

  async get(path: string, params: Record<string, string | number | undefined>): Promise<AmapApiResponse> {
    if (!ALLOWED_PATHS.has(path)) throw new AmapApiError("Unsupported AMap API path");
    const url = new URL(path, `${this.config.apiBaseUrl}/`);
    url.searchParams.set("key", this.config.key);
    url.searchParams.set("output", "JSON");
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(name, String(value));
    }
    if (this.config.privateKey) {
      url.searchParams.set(
        "sig",
        signAmapRequest(Object.fromEntries(url.searchParams.entries()), this.config.privateKey),
      );
    }

    this.acquireNetworkSlot();
    try {
      const result = await this.request(url);
      this.successfulInvocationsTotal += 1;
      this.lastSuccessAt = Date.now();
      return result;
    } catch (error) {
      const normalized = normalizeRequestError(error);
      this.failedInvocationsTotal += 1;
      this.lastErrorAt = Date.now();
      this.lastError = sanitizeProviderInfo(normalized.message, this.config);
      throw normalized;
    } finally {
      this.activeRequests -= 1;
    }
  }

  /** 执行只读 GET 与有限重试；分钟封禁 10004 快速失败，避免立即重试继续浪费配额。 */
  private async request(url: URL): Promise<AmapApiResponse> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.retryAttempts; attempt += 1) {
      try {
        // 限流统计真实 HTTP 尝试而非逻辑 Tool Call；重试同样消耗上游 QPS，不能绕过本地配额。
        this.consumeRateLimit();
        this.attemptsTotal += 1;
        const response = await fetch(url, {
          method: "GET",
          headers: { Accept: "application/json", "User-Agent": "openclaw-amap/2026.7.1" },
          signal: AbortSignal.timeout(this.config.requestTimeoutMs),
          // Key 和 sig 都在查询串中，禁止 fetch 把带凭据 URL 自动转发给 3xx 目标。
          redirect: "manual",
        });
        const body = await readBoundedBody(response, this.config.maxResponseBytes);
        if ((response.status === 429 || response.status >= 500) && attempt < this.config.retryAttempts) {
          await retryDelay(attempt);
          continue;
        }
        if (!response.ok) throw new AmapApiError(`AMap API HTTP ${response.status}`);
        const envelope = parseEnvelope(body);
        if (envelope.status !== "1") {
          const code = typeof envelope.infocode === "string" ? envelope.infocode : "";
          if (RETRYABLE_INFO_CODES.has(code) && attempt < this.config.retryAttempts) {
            await retryDelay(attempt);
            continue;
          }
          throw new AmapApiError(
            `AMap API rejected the request: ${sanitizeProviderInfo(envelope.info, this.config)}`,
            code,
          );
        }
        // 官方成功信封同时声明 status=1 与 infocode=10000；只满足一项属于畸形响应。
        if (envelope.infocode !== "10000") {
          throw new AmapApiError("AMap API returned an invalid success envelope");
        }
        return envelope;
      } catch (error) {
        lastError = error;
        const retryable = error instanceof TypeError
          || (error instanceof DOMException && error.name === "TimeoutError");
        if (!retryable || attempt >= this.config.retryAttempts) break;
        await retryDelay(attempt);
      }
    }
    throw normalizeRequestError(lastError);
  }

  private consumeRateLimit(now = Date.now()): void {
    this.pruneRateLimitWindow(now);
    if (this.requestTimestamps.length >= this.config.maxRequestsPerMinute) {
      this.rateLimitRejectedTotal += 1;
      throw new AmapApiError("AMap local request rate limit exceeded");
    }
    this.requestTimestamps.push(now);
  }

  /** 并发达到上限时快速失败，避免 Agent 并发调用形成无界等待队列。 */
  private acquireNetworkSlot(): void {
    if (this.activeRequests >= this.config.maxConcurrentRequests) {
      this.concurrencyRejectedTotal += 1;
      throw new AmapApiError("AMap local concurrent request limit exceeded");
    }
    this.activeRequests += 1;
  }

  private pruneRateLimitWindow(now: number): void {
    const cutoff = now - 60_000;
    while (this.requestTimestamps[0] !== undefined && this.requestTimestamps[0] <= cutoff) {
      this.requestTimestamps.shift();
    }
  }
}

/**
 * 按高德 Web Service 数字签名规则计算 sig。
 * 请求参数（包括 key，不包括 sig）按参数名升序拼接，末尾追加私钥后以 UTF-8 计算 MD5。
 */
export function signAmapRequest(params: Record<string, string>, privateKey: string): string {
  const canonical = Object.entries(params)
    .filter(([name]) => name !== "sig")
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
  return createHash("md5").update(`${canonical}${privateKey}`, "utf8").digest("hex");
}

function parseEnvelope(body: string): AmapApiResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new AmapApiError("AMap API returned invalid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AmapApiError("AMap API returned an invalid response envelope");
  }
  return parsed as AmapApiResponse;
}

function normalizeRequestError(error: unknown): AmapApiError {
  if (error instanceof AmapApiError) return error;
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new AmapApiError("AMap API request timed out");
  }
  return new AmapApiError("AMap API request failed");
}

function sanitizeProviderInfo(value: unknown, config: AmapPluginConfig): string {
  if (typeof value !== "string") return "unknown error";
  // 高德通常只返回错误常量，但安全边界不能依赖供应商永远不回显请求 URL 或 Key。
  // 先遮蔽结构化凭据，再移除配置中的实际 Key，最后压平控制字符防止日志注入。
  let sanitized = value
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/giu, "$1[REDACTED]@")
    .replace(/(bearer\s+)[^\s,;"']+/giu, "$1[REDACTED]")
    .replace(/((?:authorization|api[_-]?key|access[_-]?token|key)\s*[=:]\s*)[^\s,;"']+/giu, "$1[REDACTED]");
  sanitized = redactLiteral(sanitized, config.key);
  sanitized = redactLiteral(sanitized, config.privateKey ?? "");
  sanitized = sanitized.replace(/[\u0000-\u001F\u007F\u2028\u2029]/gu, " ").trim();
  return sanitized.slice(0, 256) || "unknown error";
}

async function retryDelay(attempt: number): Promise<void> {
  const base = Math.min(250 * 2 ** attempt, 1_000);
  // 多 Gateway 同时收到 429/网关忙时，固定退避会让下一轮再次同步撞击上游。
  const jittered = Math.round(base * (0.8 + Math.random() * 0.4));
  await delay(jittered);
}

function redactLiteral(value: string, secret: string): string {
  return secret ? value.split(secret).join("[REDACTED]") : value;
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new AmapApiError("AMap API response exceeded maxResponseBytes");
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
        await reader.cancel("AMap response exceeded maxResponseBytes");
        throw new AmapApiError("AMap API response exceeded maxResponseBytes");
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
