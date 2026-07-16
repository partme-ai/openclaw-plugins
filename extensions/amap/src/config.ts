import type { AmapPluginConfig } from "./types.js";

const DEFAULT_BASE_URL = "https://restapi.amap.com";

export function resolveAmapConfig(
  raw: Record<string, unknown> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): AmapPluginConfig | null {
  const config = raw ?? {};
  if (config.enabled !== true) return null;
  const key = readString(config.key, "key", 256, false) || env.AMAP_WEB_SERVICE_KEY?.trim() || "";
  if (!key) throw new Error("amap.key is required (or set AMAP_WEB_SERVICE_KEY)");
  const apiBaseUrl = validateBaseUrl(readString(config.apiBaseUrl, "apiBaseUrl", 2048, false) || DEFAULT_BASE_URL);
  return {
    enabled: true,
    key,
    apiBaseUrl,
    requestTimeoutMs: readInteger(config.requestTimeoutMs, "requestTimeoutMs", 500, 30_000, 8_000),
    retryAttempts: readInteger(config.retryAttempts, "retryAttempts", 0, 3, 1),
    maxResponseBytes: readInteger(config.maxResponseBytes, "maxResponseBytes", 1_024, 5_242_880, 1_048_576),
    maxRequestsPerMinute: readInteger(config.maxRequestsPerMinute, "maxRequestsPerMinute", 1, 10_000, 120),
    ownerOnly: config.ownerOnly === true,
  };
}

function readString(value: unknown, name: string, maxLength: number, required: boolean): string {
  if (value === undefined) {
    if (required) throw new Error(`amap.${name} is required`);
    return "";
  }
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new Error(`amap.${name} must be a non-empty string up to ${maxLength} characters`);
  }
  return value.trim();
}

function readInteger(value: unknown, name: string, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`amap.${name} must be an integer between ${min} and ${max}`);
  }
  return value as number;
}

function validateBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("amap.apiBaseUrl must be a valid URL");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("amap.apiBaseUrl must use HTTPS (HTTP is allowed only for loopback tests)");
  }
  if (url.username || url.password || url.search || url.hash) throw new Error("amap.apiBaseUrl must not contain credentials, query, or fragment");
  return url.toString().replace(/\/$/, "");
}
