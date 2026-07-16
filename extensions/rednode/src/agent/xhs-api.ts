/**
 * @fileoverview 小红书 Rednode Ark Open API 的签名客户端与调用边界。
 *
 * 只允许调用配置白名单中的 operation，严格替换路径参数并规范查询参数，按 Ark 规则生成
 * MD5 请求签名。客户端同时限制请求/响应大小、请求频率和网络超时，且不会把 appSecret
 * 拼入 URL 或错误信息。
 */
import { createHash } from "node:crypto";
import type { RednodeApiResponse, RednodeOperation, RednodePluginConfig } from "../types.js";

export class RednodeApiError extends Error {
  constructor(message: string, readonly code?: string | number) {
    super(message);
    this.name = "RednodeApiError";
  }
}

/** 执行白名单 Ark operation、签名请求并校验响应的共享客户端。 */
export class RednodeClient {
  private readonly operations = new Map<string, RednodeOperation>();
  private readonly requestTimestamps: number[] = [];

  constructor(private readonly config: RednodePluginConfig) {
    for (const operation of config.operations) this.operations.set(operation.name, operation);
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
    if (!operation) throw new RednodeApiError(`Unknown or disallowed Rednode operation: ${params.operation}`);
    const path = resolvePath(operation.apiPath, params.pathParams ?? {});
    const query = normalizeQuery(params.query ?? {});
    const bodyJson = operation.method === "GET" ? undefined : JSON.stringify(params.body ?? {});
    if (bodyJson && Buffer.byteLength(bodyJson) > this.config.maxRequestBytes) throw new RednodeApiError("Rednode request body exceeded maxRequestBytes");
    this.consumeRateLimit();

    const timestamp = String(Math.floor(Date.now() / 1_000));
    const signatureParams = { ...query, "app-key": this.config.appKey, timestamp };
    const sign = signRednodeRequest(path, signatureParams, this.config.appSecret);
    const url = new URL(path, `${this.config.apiBaseUrl}/`);
    for (const [key, value] of Object.entries(query).sort(([a], [b]) => a.localeCompare(b))) url.searchParams.set(key, value);

    let response: Response;
    try {
      response = await fetch(url, {
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
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") throw new RednodeApiError("Rednode API request timed out");
      throw new RednodeApiError(`Rednode API request failed: ${error instanceof Error ? error.message.slice(0, 300) : "unknown network error"}`);
    }
    const text = await readBoundedBody(response, this.config.maxResponseBytes);
    if (!response.ok) throw new RednodeApiError(`Rednode API HTTP ${response.status}`);
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new RednodeApiError("Rednode API returned invalid JSON"); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new RednodeApiError("Rednode API returned an invalid response object");
    const result = parsed as RednodeApiResponse;
    if (result.success === false) {
      throw new RednodeApiError(`Rednode API rejected the request: ${String(result.error_msg ?? "unknown error")}`, result.error_code as string | number | undefined);
    }
    return result;
  }

  private consumeRateLimit(now = Date.now()): void {
    const cutoff = now - 60_000;
    while (this.requestTimestamps[0] !== undefined && this.requestTimestamps[0] <= cutoff) this.requestTimestamps.shift();
    if (this.requestTimestamps.length >= this.config.maxRequestsPerMinute) throw new RednodeApiError("Rednode local request rate limit exceeded");
    this.requestTimestamps.push(now);
  }
}

export function signRednodeRequest(path: string, params: Record<string, string>, appSecret: string): string {
  const pairs = Object.entries(params)
    .filter(([, value]) => value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return createHash("md5").update(`${path}?${pairs}${appSecret}`, "utf8").digest("hex");
}

function resolvePath(template: string, values: Record<string, unknown>): string {
  const expected = new Set(Array.from(template.matchAll(/\{([^}]+)\}/g), (match) => match[1]!));
  for (const key of Object.keys(values)) if (!expected.has(key)) throw new RednodeApiError(`Unexpected path parameter: ${key}`);
  return template.replaceAll(/\{([^}]+)\}/g, (_match, key: string) => {
    const value = values[key];
    if ((typeof value !== "string" && typeof value !== "number") || !String(value).trim() || String(value).length > 256) {
      throw new RednodeApiError(`Missing or invalid path parameter: ${key}`);
    }
    return encodeURIComponent(String(value).trim());
  });
}

function normalizeQuery(values: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)) throw new RednodeApiError(`Invalid query parameter name: ${key}`);
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") throw new RednodeApiError(`Invalid query parameter value: ${key}`);
    const normalized = String(value);
    if (normalized.length > 2048) throw new RednodeApiError(`Query parameter is too long: ${key}`);
    result[key] = normalized;
  }
  return result;
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) throw new RednodeApiError("Rednode API response exceeded maxResponseBytes");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new RednodeApiError("Rednode API response exceeded maxResponseBytes");
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(joined);
}
