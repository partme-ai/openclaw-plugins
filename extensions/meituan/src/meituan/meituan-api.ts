/**
 * @fileoverview 美团 MTOp OpenAPI 的签名客户端与网络安全边界。
 *
 * 客户端只允许调用配置声明的 operation，按美团规则生成 SHA-1 签名，并在发出请求前执行
 * 认证检查、请求体大小限制、进程内并发/分钟限流与写操作幂等占位；响应读取设置硬上限，
 * 错误信息会脱敏签名密钥与授权 Token，防止外部异常将凭据带入日志。
 */
import { createHash } from "node:crypto";
import type {
  MeituanApiResponse,
  MeituanClientStatus,
  MeituanOperation,
  MeituanPluginConfig,
} from "../types.js";
import { safeMeituanError } from "../shared/safe-error.js";

type MeituanClientDependencies = {
  fetch: typeof globalThis.fetch;
  now: () => number;
  random: () => number;
  sleep: (delayMs: number) => Promise<void>;
};

const DEFAULT_DEPENDENCIES: MeituanClientDependencies = {
  fetch: (...args) => globalThis.fetch(...args),
  now: Date.now,
  random: Math.random,
  sleep: (delayMs) =>
    new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    }),
};

/** 美团调用失败的统一错误，`code` 保存经过校验的平台业务错误码。 */
export class MeituanApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "MeituanApiError";
  }
}

/**
 * 美团 MTOp 白名单客户端。
 *
 * 每个实例持有一份不可扩展的 operation 映射和本进程滑动窗口；调用方只能按配置名称发起请求，
 * 不能绕过签名、认证、容量和成功码校验直接访问任意接口。
 */
export class MeituanClient {
  private readonly operations = new Map<string, MeituanOperation>();
  private readonly requestTimestamps: number[] = [];
  /** 写请求一旦真正开始便保留占位到 TTL；网络超时也不能贸然释放并重复下单/退款。 */
  private readonly idempotencyClaims = new Map<string, number>();
  private readonly dependencies: MeituanClientDependencies;
  private activeRequests = 0;
  private attemptsTotal = 0;
  private successfulInvocationsTotal = 0;
  private failedInvocationsTotal = 0;
  private concurrencyRejectedTotal = 0;
  private rateLimitRejectedTotal = 0;
  private duplicateWriteRejectedTotal = 0;
  private lastSuccessAt: number | null = null;
  private lastErrorAt: number | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly config: MeituanPluginConfig,
    dependencies: Partial<MeituanClientDependencies> = {},
  ) {
    this.dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencies };
    for (const operation of config.operations)
      this.operations.set(operation.name, operation);
  }

  /** 返回管理员配置的 operation；工具层据此执行 read/write 风险确认。 */
  getOperation(name: string): MeituanOperation | undefined {
    return this.operations.get(name);
  }

  /** 返回不包含业务参数、门店标识和凭据的低敏进程内状态。 */
  status(): MeituanClientStatus {
    const now = this.dependencies.now();
    this.pruneRateLimitWindow(now);
    this.pruneIdempotencyClaims(now);
    return {
      activeRequests: this.activeRequests,
      maxConcurrentRequests: this.config.maxConcurrentRequests,
      requestsInCurrentWindow: this.requestTimestamps.length,
      maxRequestsPerMinute: this.config.maxRequestsPerMinute,
      idempotencyEntries: this.idempotencyClaims.size,
      maxIdempotencyEntries: this.config.maxIdempotencyEntries,
      attemptsTotal: this.attemptsTotal,
      successfulInvocationsTotal: this.successfulInvocationsTotal,
      failedInvocationsTotal: this.failedInvocationsTotal,
      concurrencyRejectedTotal: this.concurrencyRejectedTotal,
      rateLimitRejectedTotal: this.rateLimitRejectedTotal,
      duplicateWriteRejectedTotal: this.duplicateWriteRejectedTotal,
      lastSuccessAt: this.lastSuccessAt,
      lastErrorAt: this.lastErrorAt,
      lastError: this.lastError,
    };
  }

  async invoke(
    operationName: string,
    biz: Record<string, unknown>,
  ): Promise<MeituanApiResponse> {
    const operation = this.operations.get(operationName);
    if (!operation)
      throw new MeituanApiError(
        `Unknown or disallowed Meituan operation: ${operationName}`,
      );
    if (operation.requiresAuth && !this.config.appAuthToken) {
      throw new MeituanApiError(
        `Meituan operation ${operationName} requires appAuthToken`,
      );
    }
    const bizJson = JSON.stringify(biz);
    if (Buffer.byteLength(bizJson) > this.config.maxRequestBytes) {
      throw new MeituanApiError("Meituan biz payload exceeded maxRequestBytes");
    }
    const url = new URL(operation.apiPath, `${this.config.apiBaseUrl}/`);
    // 在占用并发槽和幂等容量前验证一次完整表单；重试时仍会重新生成 timestamp 与签名。
    this.buildFormBody(operation, bizJson, this.dependencies.now());
    const idempotencyKey = this.prepareIdempotencyKey(operation, biz);
    this.acquireNetworkSlot();
    try {
      const response = await this.request(operation, url, bizJson, idempotencyKey);
      const body = await readBoundedBody(response, this.config.maxResponseBytes);
      if (!response.ok)
        throw new MeituanApiError(`Meituan API HTTP ${response.status}`);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new MeituanApiError("Meituan API returned invalid JSON");
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new MeituanApiError(
          "Meituan API returned an invalid response object",
        );
      }
      const result = parsed as MeituanApiResponse;
      const code = result.code;
      if (typeof code !== "string") {
        throw new MeituanApiError(
          "Meituan API response is missing a string code",
        );
      }
      if (!operation.successCodes.includes(code)) {
        const detail = safeExternalText(
          result.message ??
            result.msg ??
            result.subMsg ??
            "unknown business error",
          this.config,
        );
        throw new MeituanApiError(
          `Meituan API rejected the request: ${detail}`,
          code,
        );
      }
      this.successfulInvocationsTotal += 1;
      this.lastSuccessAt = this.dependencies.now();
      return result;
    } catch (error) {
      this.failedInvocationsTotal += 1;
      this.lastErrorAt = this.dependencies.now();
      this.lastError = safeExternalText(
        error instanceof Error ? error.message : undefined,
        this.config,
      );
      throw error;
    } finally {
      this.activeRequests -= 1;
    }
  }

  /**
   * MTOp 传输统一使用 POST，但业务语义由 operation.riskLevel 决定：只读操作可重试临时
   * 网络/HTTP 故障；写操作即使声明幂等字段也只发送一次，避免进程内占位与服务端状态不一致。
   */
  private async request(
    operation: MeituanOperation,
    url: URL,
    bizJson: string,
    idempotencyKey: string | undefined,
  ): Promise<Response> {
    const maximumAttempts =
      operation.riskLevel === "read" ? this.config.readRetryMaxAttempts : 1;
    let lastError: MeituanApiError | undefined;

    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      // 完整 Form 先通过容量校验，再消耗调用配额和写幂等槽位。
      const formBody = this.buildFormBody(operation, bizJson, this.dependencies.now());
      this.consumeRateLimit(this.dependencies.now());
      if (idempotencyKey) this.claimWrite(idempotencyKey, this.dependencies.now());
      this.attemptsTotal += 1;
      try {
        const response = await this.dependencies.fetch(url, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            DeveloperId: this.config.developerId,
            "Sdk-Info": "openclaw-meituan-2026.7.1",
            "User-Agent": "openclaw-meituan/2026.7.1",
          },
          body: formBody,
          signal: AbortSignal.timeout(this.config.requestTimeoutMs),
          // 表单含签名和门店 Token，禁止 3xx 自动把凭据转发到另一个 Origin。
          redirect: "manual",
        });
        if (
          operation.riskLevel === "read" &&
          isRetryableStatus(response.status) &&
          attempt < maximumAttempts
        ) {
          await response.body?.cancel().catch(() => undefined);
          await this.waitBeforeRetry(attempt);
          continue;
        }
        return response;
      } catch (error) {
        lastError = toRequestError(error, this.config);
        if (operation.riskLevel !== "read" || attempt >= maximumAttempts)
          throw lastError;
        await this.waitBeforeRetry(attempt);
      }
    }
    throw lastError ?? new MeituanApiError("Meituan API request failed");
  }

  /** 每次尝试重新生成秒级时间戳与签名，避免退避后继续使用陈旧签名。 */
  private buildFormBody(
    operation: MeituanOperation,
    bizJson: string,
    now: number,
  ): URLSearchParams {
    const fields: Record<string, string> = {
      biz: bizJson,
      timestamp: String(Math.floor(now / 1_000)),
      businessId: String(operation.businessId),
      developerId: this.config.developerId,
      charset: "UTF-8",
      version: this.config.version,
    };
    // 无鉴权 operation 不应附带门店 Token；即使配置中存在，也只向确实需要它的接口披露。
    if (operation.requiresAuth && this.config.appAuthToken)
      fields.appAuthToken = this.config.appAuthToken;
    fields.sign = signMeituanParams(this.config.signKey, fields);
    const formBody = new URLSearchParams(fields);
    if (Buffer.byteLength(formBody.toString()) > this.config.maxRequestBytes) {
      throw new MeituanApiError(
        "Meituan complete form payload exceeded maxRequestBytes",
      );
    }
    return formBody;
  }

  /** 从受控 operation 指定的顶层 biz 字段构造低敏哈希键，原始业务编号不进入状态输出。 */
  private prepareIdempotencyKey(
    operation: MeituanOperation,
    biz: Record<string, unknown>,
  ): string | undefined {
    if (operation.riskLevel !== "write" || !operation.idempotencyBizField)
      return undefined;
    const field = operation.idempotencyBizField;
    const value = biz[field];
    if (
      (typeof value !== "string" && typeof value !== "number") ||
      (typeof value === "number" && !Number.isFinite(value)) ||
      !String(value).trim() ||
      String(value).length > 256 ||
      /[\u0000-\u001f\u007f]/u.test(String(value))
    ) {
      throw new MeituanApiError(
        `Meituan write operation requires a valid biz.${field} idempotency value`,
      );
    }
    const digest = createHash("sha256")
      .update(`${operation.name}\u0000${typeof value}\u0000${String(value).trim()}`, "utf8")
      .digest("hex");
    this.pruneIdempotencyClaims(this.dependencies.now());
    if (this.idempotencyClaims.has(digest)) {
      this.duplicateWriteRejectedTotal += 1;
      throw new MeituanApiError("Meituan duplicate write request rejected locally");
    }
    if (this.idempotencyClaims.size >= this.config.maxIdempotencyEntries) {
      throw new MeituanApiError("Meituan local idempotency ledger is full");
    }
    return digest;
  }

  /** 在第一次真实发送前同步占位；同一 JS 事件循环内不会出现检查后并发写入窗口。 */
  private claimWrite(key: string, now: number): void {
    if (this.idempotencyClaims.has(key)) {
      this.duplicateWriteRejectedTotal += 1;
      throw new MeituanApiError("Meituan duplicate write request rejected locally");
    }
    this.idempotencyClaims.set(key, now + this.config.idempotencyTtlMs);
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
    await this.dependencies.sleep(Math.max(0, Math.round(exponential + jitter)));
  }

  /** 单进程滑动窗口限流；每次真实 HTTP 尝试（包括只读重试）都计入配额。 */
  private consumeRateLimit(now: number): void {
    this.pruneRateLimitWindow(now);
    if (this.requestTimestamps.length >= this.config.maxRequestsPerMinute) {
      this.rateLimitRejectedTotal += 1;
      throw new MeituanApiError("Meituan local request rate limit exceeded");
    }
    this.requestTimestamps.push(now);
  }

  /** 达到并发上限时快速失败，不创建无界排队 Promise。 */
  private acquireNetworkSlot(): void {
    if (this.activeRequests >= this.config.maxConcurrentRequests) {
      this.concurrencyRejectedTotal += 1;
      throw new MeituanApiError("Meituan local concurrent request limit exceeded");
    }
    this.activeRequests += 1;
  }

  private pruneRateLimitWindow(now: number): void {
    const cutoff = now - 60_000;
    while (
      this.requestTimestamps[0] !== undefined &&
      this.requestTimestamps[0] <= cutoff
    )
      this.requestTimestamps.shift();
  }

  private pruneIdempotencyClaims(now: number): void {
    for (const [key, expiresAt] of this.idempotencyClaims)
      if (expiresAt <= now) this.idempotencyClaims.delete(key);
  }
}

/**
 * 按 MTOp 规则对非空参数名排序，以 `signKey + key + value...` 计算小写 SHA-1。
 * `sign` 字段本身必须排除，避免重签名时把旧签名带入摘要。
 */
export function signMeituanParams(
  signKey: string,
  params: Record<string, string>,
): string {
  const sorted = Object.keys(params).sort();
  let base = signKey;
  for (const key of sorted) {
    if (key.toLowerCase() === "sign") continue;
    const value = params[key];
    if (value) base += key + value;
  }
  return createHash("sha1").update(base, "utf8").digest("hex");
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new MeituanApiError("Meituan API response exceeded maxResponseBytes");
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
        await reader.cancel("Meituan response exceeded maxResponseBytes");
        throw new MeituanApiError(
          "Meituan API response exceeded maxResponseBytes",
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

function safeErrorMessage(error: unknown, config: MeituanPluginConfig): string {
  return safeMeituanError(
    error,
    [config.signKey, config.appAuthToken, config.developerId],
    300,
    "unknown network error",
  );
}

function toRequestError(
  error: unknown,
  config: MeituanPluginConfig,
): MeituanApiError {
  if (error instanceof DOMException && error.name === "TimeoutError")
    return new MeituanApiError("Meituan API request timed out");
  return new MeituanApiError(
    `Meituan API request failed: ${safeErrorMessage(error, config)}`,
  );
}

/** 408/429/5xx 只对 read operation 视为临时传输故障；业务错误码绝不自动重试。 */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** 清洗平台/网络返回的不可信文本，并额外替换当前真实凭据值。 */
function safeExternalText(value: unknown, config: MeituanPluginConfig): string {
  return safeMeituanError(
    value,
    [config.signKey, config.appAuthToken, config.developerId],
  );
}
