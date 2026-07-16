import { createHash } from "node:crypto";
import type { MeituanApiResponse, MeituanOperation, MeituanPluginConfig } from "../types.js";

export class MeituanApiError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "MeituanApiError";
  }
}

export class MeituanClient {
  private readonly operations = new Map<string, MeituanOperation>();
  private readonly requestTimestamps: number[] = [];

  constructor(private readonly config: MeituanPluginConfig) {
    for (const operation of config.operations) this.operations.set(operation.name, operation);
  }

  async invoke(operationName: string, biz: Record<string, unknown>): Promise<MeituanApiResponse> {
    const operation = this.operations.get(operationName);
    if (!operation) throw new MeituanApiError(`Unknown or disallowed Meituan operation: ${operationName}`);
    if (operation.requiresAuth && !this.config.appAuthToken) {
      throw new MeituanApiError(`Meituan operation ${operationName} requires appAuthToken`);
    }
    const bizJson = JSON.stringify(biz);
    if (Buffer.byteLength(bizJson) > this.config.maxRequestBytes) {
      throw new MeituanApiError("Meituan biz payload exceeded maxRequestBytes");
    }
    this.consumeRateLimit();

    const fields: Record<string, string> = {
      biz: bizJson,
      timestamp: String(Math.floor(Date.now() / 1_000)),
      businessId: String(operation.businessId),
      developerId: this.config.developerId,
      charset: "UTF-8",
      version: this.config.version,
    };
    if (this.config.appAuthToken) fields.appAuthToken = this.config.appAuthToken;
    fields.sign = signMeituanParams(this.config.signKey, fields);

    const url = new URL(operation.apiPath, `${this.config.apiBaseUrl}/`);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "DeveloperId": this.config.developerId,
          "Sdk-Info": "openclaw-meituan-2026.7.1",
          "User-Agent": "openclaw-meituan/2026.7.1",
        },
        body: new URLSearchParams(fields),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new MeituanApiError("Meituan API request timed out");
      }
      throw new MeituanApiError(`Meituan API request failed: ${safeErrorMessage(error)}`);
    }

    const body = await readBoundedBody(response, this.config.maxResponseBytes);
    if (!response.ok) throw new MeituanApiError(`Meituan API HTTP ${response.status}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new MeituanApiError("Meituan API returned invalid JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new MeituanApiError("Meituan API returned an invalid response object");
    }
    return parsed as MeituanApiResponse;
  }

  private consumeRateLimit(now = Date.now()): void {
    const cutoff = now - 60_000;
    while (this.requestTimestamps[0] !== undefined && this.requestTimestamps[0] <= cutoff) {
      this.requestTimestamps.shift();
    }
    if (this.requestTimestamps.length >= this.config.maxRequestsPerMinute) {
      throw new MeituanApiError("Meituan local request rate limit exceeded");
    }
    this.requestTimestamps.push(now);
  }
}

export function signMeituanParams(signKey: string, params: Record<string, string>): string {
  const sorted = Object.keys(params).sort();
  let base = signKey;
  for (const key of sorted) {
    if (key.toLowerCase() === "sign") continue;
    const value = params[key];
    if (value) base += key + value;
  }
  return createHash("sha1").update(base, "utf8").digest("hex");
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) {
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
      if (total > maxBytes) throw new MeituanApiError("Meituan API response exceeded maxResponseBytes");
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

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "unknown network error";
  return error.message
    .replaceAll(/(signKey|appAuthToken|sign)=?[^\s&,]*/gi, "$1=[REDACTED]")
    .slice(0, 300);
}
