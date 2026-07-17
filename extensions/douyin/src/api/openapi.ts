/**
 * 抖音生活服务 OpenAPI 客户端。
 *
 * 本层统一负责 client_token 注入、响应信封校验、响应体上限和有限重试。
 * 只有查询类瞬时故障可重试；Token 失效仅刷新一次，避免并发请求形成刷新风暴。
 */
import type { ChannelLimitsOpenClawConfig } from "../runtime/runtime-api.js";
import { douyinFetch, readResponseBodyAsBuffer } from "../shared/http.js";
import type { DouyinAccountConfig } from "../types.js";
import { getClientToken, invalidateClientToken } from "../config/auth.js";

const OPENAPI_BASE = "https://open.douyin.com";
const MAX_JSON_RESPONSE_BYTES = 2 * 1024 * 1024;
const RETRY_BASE_DELAY_MS = 200;
const RETRYABLE_CODES = new Set([2100001, 2100004, 2119002, 2119003]);
const TOKEN_CODES = new Set([2190002, 2190008]);

type OpenApiEnvelope = {
  data?: Record<string, unknown> & { error_code?: number; description?: string };
  extra?: { error_code?: number; description?: string; logid?: string };
};

/**
 * 抖音 OpenAPI 的结构化失败。
 * 同时保留 HTTP 状态、平台业务码和 logId，供上层判断 token 刷新、瞬时重试和问题追踪。
 */
export class DouyinOpenApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
    readonly logId?: string,
  ) {
    super(message);
    this.name = "DouyinOpenApiError";
  }
}

/** 单次 OpenAPI 调用所需的账号凭据与 OpenClaw 网络限制上下文。 */
export type DouyinOpenApiContext = {
  account: DouyinAccountConfig;
  rootConfig?: ChannelLimitsOpenClawConfig;
};

function appendQuery(url: URL, query: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
}

function parseEnvelope(response: Response, raw: string): OpenApiEnvelope {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("response root is not an object");
    }
    return parsed as OpenApiEnvelope;
  } catch {
    throw new DouyinOpenApiError(
      `[douyin] OpenAPI returned invalid JSON (HTTP ${response.status})`,
      response.status,
    );
  }
}

function assertSuccess(response: Response, envelope: OpenApiEnvelope): void {
  const dataCode = envelope.data?.error_code ?? 0;
  const extraCode = envelope.extra?.error_code ?? 0;
  const code = dataCode !== 0 ? dataCode : extraCode;
  if (response.ok && dataCode === 0 && extraCode === 0) return;
  const description = envelope.data?.description ?? envelope.extra?.description ?? "unknown error";
  throw new DouyinOpenApiError(
    `[douyin] OpenAPI failed (${response.status}/${code}): ${description}`,
    response.status,
    code,
    envelope.extra?.logid,
  );
}

async function requestOnce(params: {
  context: DouyinOpenApiContext;
  path: string;
  method: "GET" | "POST";
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
}): Promise<OpenApiEnvelope> {
  const token = await getClientToken(params.context.account, params.context.rootConfig);
  if (!token) throw new Error("[douyin] app_key and app_secret are required");
  const url = new URL(params.path, OPENAPI_BASE);
  appendQuery(url, params.query ?? {});
  const response = await douyinFetch(params.context.rootConfig, url, {
    method: params.method,
    headers: {
      "access-token": token,
      "content-type": "application/json",
      ...(params.context.account.account_id || params.context.account.shop_id
        ? {
            "Rpc-Transit-Life-Account":
              params.context.account.account_id ?? params.context.account.shop_id ?? "",
          }
        : {}),
    },
    body: params.body ? JSON.stringify(params.body) : undefined,
  }, { timeoutMs: params.context.account.request_timeout_ms ?? 10_000 });
  const raw = (await readResponseBodyAsBuffer(response, MAX_JSON_RESPONSE_BYTES)).toString("utf8");
  const envelope = parseEnvelope(response, raw);
  assertSuccess(response, envelope);
  return envelope;
}

/**
 * 调用抖音生活服务 OpenAPI，并按接口副作用选择重试策略。
 *
 * Token 失效允许清缓存后重放一次；只有调用方明确标记 `retrySafe` 的查询接口，才会对
 * 429、5xx、网络错误和平台瞬时错误做有限指数退避。写接口不会因不确定结果而盲目重放。
 */
export async function requestDouyinOpenApi(params: {
  context: DouyinOpenApiContext;
  path: string;
  method: "GET" | "POST";
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  retrySafe?: boolean;
}): Promise<OpenApiEnvelope> {
  const maxAttempts = params.retrySafe ? 3 : 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await requestOnce(params);
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      if (error instanceof DouyinOpenApiError) {
        if (error.code && TOKEN_CODES.has(error.code)) {
          invalidateClientToken(params.context.account);
          continue;
        }
        const retryable = params.retrySafe && (
          error.status === 429 || error.status >= 500 || (error.code != null && RETRYABLE_CODES.has(error.code))
        );
        if (!retryable) throw error;
      } else if (!params.retrySafe) {
        throw error;
      }
      const delayMs = Math.min(2_000, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("[douyin] OpenAPI request exhausted retries");
}
