/**
 * 高德 Web 服务配置解析与安全边界。
 *
 * API Key 可来自插件配置或环境变量；数值参数全部实施硬边界，远程 API 基址必须
 * 经过 URL 校验，避免 capability 工具被配置成任意网络请求代理。
 */
import type { AmapPluginConfig } from "./types.js";

const DEFAULT_BASE_URL = "https://restapi.amap.com";
const CONFIG_KEYS = new Set([
  "enabled", "key", "apiBaseUrl", "requestTimeoutMs", "retryAttempts",
  "maxResponseBytes", "maxToolResultBytes", "maxRequestsPerMinute", "ownerOnly",
]);

/**
 * 把 OpenClaw 插件配置解析为可安全交给高德客户端的运行时配置。
 *
 * 未显式启用时返回 `null`；启用后拒绝未知字段、隐式类型转换、非 HTTPS 远端地址和
 * 越界资源参数。API Key 可由环境变量提供，但仍执行与配置值相同的长度校验。
 */
export function resolveAmapConfig(
  raw: Record<string, unknown> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): AmapPluginConfig | null {
  if (raw !== undefined && (!raw || typeof raw !== "object" || Array.isArray(raw))) {
    throw new Error("amap config must be an object");
  }
  const config = raw ?? {};
  const unknown = Object.keys(config).filter((key) => !CONFIG_KEYS.has(key));
  if (unknown.length > 0) throw new Error(`amap config contains unknown field: ${unknown.join(", ")}`);
  if (config.enabled !== undefined && typeof config.enabled !== "boolean") throw new Error("amap.enabled must be a boolean");
  if (config.enabled !== true) return null;
  if (config.ownerOnly !== undefined && typeof config.ownerOnly !== "boolean") throw new Error("amap.ownerOnly must be a boolean");
  const configuredKey = readString(config.key, "key", 256, false);
  const environmentKey = env.AMAP_WEB_SERVICE_KEY?.trim() ?? "";
  if (environmentKey.length > 256) throw new Error("AMAP_WEB_SERVICE_KEY must not exceed 256 characters");
  const key = configuredKey || environmentKey;
  if (!key) throw new Error("amap.key is required (or set AMAP_WEB_SERVICE_KEY)");
  if (/[\u0000-\u001F\u007F]/u.test(key)) throw new Error("amap.key must not contain control characters");
  const apiBaseUrl = validateBaseUrl(readString(config.apiBaseUrl, "apiBaseUrl", 2048, false) || DEFAULT_BASE_URL);
  const maxResponseBytes = readInteger(config.maxResponseBytes, "maxResponseBytes", 1_024, 5_242_880, 1_048_576);
  // 调小上游响应上限时，未显式配置的 Tool 上限随之收紧，避免安全默认值反而令旧配置无法启动。
  const maxToolResultBytes = readInteger(
    config.maxToolResultBytes,
    "maxToolResultBytes",
    1_024,
    1_048_576,
    Math.min(262_144, maxResponseBytes),
  );
  if (maxToolResultBytes > maxResponseBytes) {
    throw new Error("amap.maxToolResultBytes must not exceed maxResponseBytes");
  }
  return {
    enabled: true,
    key,
    apiBaseUrl,
    requestTimeoutMs: readInteger(config.requestTimeoutMs, "requestTimeoutMs", 500, 30_000, 8_000),
    retryAttempts: readInteger(config.retryAttempts, "retryAttempts", 0, 3, 1),
    maxResponseBytes,
    maxToolResultBytes,
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
  // 固定 API 路径并不能阻止 SSRF：若允许任意 HTTPS Origin，攻击者仍可让三个 GET
  // 路径命中第三方或内网服务。生产仅接受高德官方域名；loopback 只用于隔离 E2E。
  if (!loopback && url.hostname.toLowerCase() !== "restapi.amap.com") {
    throw new Error("amap.apiBaseUrl must use the official restapi.amap.com host");
  }
  if (!loopback && url.port) {
    throw new Error("amap.apiBaseUrl must not use a custom port for the official host");
  }
  return url.toString().replace(/\/$/, "");
}
