/**
 * OpenMem REST sidecar 的连接与租户安全配置。
 *
 * 远端地址强制 HTTPS，密钥只允许引用环境变量；`allowSharedRecall` 默认关闭，因为当前
 * sidecar 的 hybrid search 没有 tenant filter，误开启会扩大跨会话召回范围。
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

/**
 * OpenMem 插件完成校验后的运行时配置。
 *
 * `apiKeyEnv` 只保存环境变量名，密钥本身不会进入 OpenClaw 配置文件；
 * `allowSharedRecall=false` 时，检索必须绑定当前 OpenClaw 会话对应的 OpenMem session。
 */
export interface OpenMemConfig {
  enabled: boolean;
  required: boolean;
  baseUrl: string;
  agentId: string;
  maxSearchResults: number;
  timeoutMs: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  maxResponseBytes: number;
  maxCacheBytes: number;
  allowSharedRecall: boolean;
  apiKeyEnv?: string;
  authHeader: string;
  authScheme: string;
}

const DEFAULTS: OpenMemConfig = {
  enabled: true,
  required: false,
  baseUrl: "http://127.0.0.1:3317",
  agentId: "main",
  maxSearchResults: 10,
  timeoutMs: 5_000,
  maxAttempts: 3,
  retryBaseDelayMs: 100,
  maxResponseBytes: 2 * 1024 * 1024,
  maxCacheBytes: 8 * 1024 * 1024,
  allowSharedRecall: false,
  authHeader: "Authorization",
  authScheme: "Bearer",
};

const CONFIG_KEYS = new Set([
  "enabled", "required", "baseUrl", "agentId", "maxSearchResults", "timeoutMs",
  "maxAttempts", "retryBaseDelayMs", "maxResponseBytes", "maxCacheBytes",
  "allowSharedRecall", "apiKeyEnv", "authHeader", "authScheme",
]);

function integer(name: string, value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`[openmem] ${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function boolean(name: string, value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`[openmem] ${name} must be a boolean`);
  return value;
}

function isLoopback(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "localhost" || normalized === "::1" || normalized.startsWith("127.");
}

/**
 * 校验并规范化 OpenClaw 传入的 OpenMem 配置。
 *
 * 该函数会拒绝未知字段、隐式类型转换、非本机明文 HTTP、URL 内嵌凭据以及不安全的
 * Header 配置，避免手写配置绕过 manifest JSON Schema 后带着错误值进入网络边界。
 */
export function resolveConfig(api: Pick<OpenClawPluginApi, "pluginConfig">): OpenMemConfig {
  const input = api.pluginConfig ?? {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("[openmem] pluginConfig must be an object");
  }
  const raw = input as Partial<OpenMemConfig> & Record<string, unknown>;
  const unknown = Object.keys(raw).filter((key) => !CONFIG_KEYS.has(key));
  if (unknown.length > 0) throw new Error(`[openmem] unknown config field: ${unknown.join(", ")}`);
  for (const key of ["baseUrl", "agentId", "apiKeyEnv", "authHeader", "authScheme"] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== "string") {
      throw new Error(`[openmem] ${key} must be a string`);
    }
  }
  const url = new URL(typeof raw.baseUrl === "string" ? raw.baseUrl : DEFAULTS.baseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("[openmem] baseUrl must use http or https");
  if (url.username || url.password || url.search || url.hash) throw new Error("[openmem] baseUrl must not contain credentials, query, or fragment");
  if (url.protocol === "http:" && !isLoopback(url.hostname)) {
    throw new Error("[openmem] non-loopback baseUrl must use HTTPS");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  const apiKeyEnv = typeof raw.apiKeyEnv === "string" ? raw.apiKeyEnv.trim() : undefined;
  if (apiKeyEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) throw new Error("[openmem] apiKeyEnv is invalid");
  if (apiKeyEnv && !process.env[apiKeyEnv]) throw new Error(`[openmem] ${apiKeyEnv} is not set`);
  const agentId = typeof raw.agentId === "string" ? raw.agentId.trim() : DEFAULTS.agentId;
  if (!agentId) throw new Error("[openmem] agentId must not be empty");
  if (agentId.length > 128 || /[\u0000-\u001f\u007f]/.test(agentId)) throw new Error("[openmem] agentId is invalid");
  const authHeader = typeof raw.authHeader === "string" ? raw.authHeader.trim() : DEFAULTS.authHeader;
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(authHeader)) throw new Error("[openmem] authHeader is invalid");
  const authScheme = typeof raw.authScheme === "string" ? raw.authScheme.trim() : DEFAULTS.authScheme;
  if (authScheme.length > 64 || /[^\x20-\x7e]/.test(authScheme)) throw new Error("[openmem] authScheme is invalid");

  return {
    enabled: boolean("enabled", raw.enabled, DEFAULTS.enabled),
    required: boolean("required", raw.required, DEFAULTS.required),
    baseUrl: url.toString().replace(/\/$/, ""),
    agentId,
    maxSearchResults: integer("maxSearchResults", raw.maxSearchResults, DEFAULTS.maxSearchResults, 1, 100),
    timeoutMs: integer("timeoutMs", raw.timeoutMs, DEFAULTS.timeoutMs, 100, 120_000),
    maxAttempts: integer("maxAttempts", raw.maxAttempts, DEFAULTS.maxAttempts, 1, 5),
    retryBaseDelayMs: integer("retryBaseDelayMs", raw.retryBaseDelayMs, DEFAULTS.retryBaseDelayMs, 0, 5_000),
    maxResponseBytes: integer("maxResponseBytes", raw.maxResponseBytes, DEFAULTS.maxResponseBytes, 1024, 16 * 1024 * 1024),
    maxCacheBytes: integer("maxCacheBytes", raw.maxCacheBytes, DEFAULTS.maxCacheBytes, 1024 * 1024, 64 * 1024 * 1024),
    allowSharedRecall: boolean("allowSharedRecall", raw.allowSharedRecall, DEFAULTS.allowSharedRecall),
    ...(apiKeyEnv ? { apiKeyEnv } : {}),
    authHeader,
    authScheme,
  };
}
