/**
 * @fileoverview 美团 MTOp OpenAPI 的签名客户端与网络安全边界。
 *
 * 客户端只允许调用配置声明的 operation，按美团规则生成 SHA-1 签名，并在发出请求前执行
 * 认证检查、请求体大小限制和进程内分钟限流；响应读取设置硬上限，错误信息会脱敏签名密钥
 * 与授权 Token，防止外部异常将凭据带入日志。
 */
import { createHash } from "node:crypto";
import type {
  MeituanApiResponse,
  MeituanOperation,
  MeituanPluginConfig,
} from "../types.js";
import { safeMeituanError } from "../shared/safe-error.js";

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

  constructor(private readonly config: MeituanPluginConfig) {
    for (const operation of config.operations)
      this.operations.set(operation.name, operation);
  }

  /** 返回管理员配置的 operation；工具层据此执行 read/write 风险确认。 */
  getOperation(name: string): MeituanOperation | undefined {
    return this.operations.get(name);
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
    const fields: Record<string, string> = {
      biz: bizJson,
      timestamp: String(Math.floor(Date.now() / 1_000)),
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

    const url = new URL(operation.apiPath, `${this.config.apiBaseUrl}/`);
    // 只有完整请求通过本地校验后才消耗配额；本地序列化/容量错误不是真实平台调用。
    this.consumeRateLimit();
    let response: Response;
    try {
      response = await fetch(url, {
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
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new MeituanApiError("Meituan API request timed out");
      }
      throw new MeituanApiError(
        `Meituan API request failed: ${safeErrorMessage(error, this.config)}`,
      );
    }

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
    return result;
  }

  private consumeRateLimit(now = Date.now()): void {
    const cutoff = now - 60_000;
    while (
      this.requestTimestamps[0] !== undefined &&
      this.requestTimestamps[0] <= cutoff
    ) {
      this.requestTimestamps.shift();
    }
    if (this.requestTimestamps.length >= this.config.maxRequestsPerMinute) {
      throw new MeituanApiError("Meituan local request rate limit exceeded");
    }
    this.requestTimestamps.push(now);
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

/** 清洗平台/网络返回的不可信文本，并额外替换当前真实凭据值。 */
function safeExternalText(value: unknown, config: MeituanPluginConfig): string {
  return safeMeituanError(
    value,
    [config.signKey, config.appAuthToken, config.developerId],
  );
}
