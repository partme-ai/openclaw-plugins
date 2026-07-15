import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

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
  allowSharedRecall: false,
  authHeader: "Authorization",
  authScheme: "Bearer",
};

function integer(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function isLoopback(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "localhost" || normalized === "::1" || normalized.startsWith("127.");
}

export function resolveConfig(api: Pick<OpenClawPluginApi, "pluginConfig">): OpenMemConfig {
  const raw = (api.pluginConfig ?? {}) as Partial<OpenMemConfig>;
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
  const authHeader = typeof raw.authHeader === "string" ? raw.authHeader.trim() : DEFAULTS.authHeader;
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(authHeader)) throw new Error("[openmem] authHeader is invalid");

  return {
    enabled: raw.enabled !== false,
    required: raw.required === true,
    baseUrl: url.toString().replace(/\/$/, ""),
    agentId,
    maxSearchResults: integer(raw.maxSearchResults, DEFAULTS.maxSearchResults, 1, 100),
    timeoutMs: integer(raw.timeoutMs, DEFAULTS.timeoutMs, 100, 120_000),
    maxAttempts: integer(raw.maxAttempts, DEFAULTS.maxAttempts, 1, 5),
    retryBaseDelayMs: integer(raw.retryBaseDelayMs, DEFAULTS.retryBaseDelayMs, 0, 5_000),
    maxResponseBytes: integer(raw.maxResponseBytes, DEFAULTS.maxResponseBytes, 1024, 16 * 1024 * 1024),
    allowSharedRecall: raw.allowSharedRecall === true,
    ...(apiKeyEnv ? { apiKeyEnv } : {}),
    authHeader,
    authScheme: typeof raw.authScheme === "string" ? raw.authScheme.trim() : DEFAULTS.authScheme,
  };
}
