import type { RednodeOperation, RednodePluginConfig } from "./types.js";

const PRODUCTION_BASE = "https://ark.xiaohongshu.com";
const SANDBOX_BASE = "http://flssandbox.xiaohongshu.com";

export function resolveRednodeConfig(
  raw: Record<string, unknown> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): RednodePluginConfig | null {
  const config = raw ?? {};
  if (config.enabled !== true) return null;
  const appKey = readString(config.appKey, "appKey", 256, false)
    || readEnv(env.XHS_APP_KEY, "XHS_APP_KEY", 256);
  const appSecret = readString(config.appSecret, "appSecret", 512, false)
    || readEnv(env.XHS_APP_SECRET, "XHS_APP_SECRET", 512);
  if (!appKey) throw new Error("rednode.appKey is required (or set XHS_APP_KEY)");
  if (!appSecret) throw new Error("rednode.appSecret is required (or set XHS_APP_SECRET)");
  const environment = config.environment === undefined ? "production" : config.environment;
  if (environment !== "production" && environment !== "sandbox") {
    throw new Error("rednode.environment must be production or sandbox");
  }
  const defaultBase = environment === "sandbox" ? SANDBOX_BASE : PRODUCTION_BASE;
  return {
    enabled: true,
    appKey,
    appSecret,
    environment,
    apiBaseUrl: validateBaseUrl(readString(config.apiBaseUrl, "apiBaseUrl", 2048, false) || defaultBase, environment),
    operations: readOperations(config.operations),
    requestTimeoutMs: readInteger(config.requestTimeoutMs, "requestTimeoutMs", 500, 60_000, 30_000),
    maxRequestBytes: readInteger(config.maxRequestBytes, "maxRequestBytes", 256, 1_048_576, 65_536),
    maxResponseBytes: readInteger(config.maxResponseBytes, "maxResponseBytes", 1_024, 10_485_760, 2_097_152),
    maxRequestsPerMinute: readInteger(config.maxRequestsPerMinute, "maxRequestsPerMinute", 1, 10_000, 60),
    ownerOnly: config.ownerOnly !== false,
  };
}

function readOperations(value: unknown): RednodeOperation[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new Error("rednode.operations must contain between 1 and 100 operations");
  }
  const names = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`rednode.operations[${index}] must be an object`);
    const raw = item as Record<string, unknown>;
    const name = readString(raw.name, `operations[${index}].name`, 64, true);
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(name)) throw new Error(`rednode.operations[${index}].name is invalid`);
    if (names.has(name)) throw new Error(`rednode operation name is duplicated: ${name}`);
    names.add(name);
    const method = raw.method;
    if (method !== "GET" && method !== "POST" && method !== "PUT") throw new Error(`rednode.operations[${index}].method is invalid`);
    return {
      name,
      method,
      apiPath: validateApiPath(readString(raw.apiPath, `operations[${index}].apiPath`, 256, true)),
      description: readString(raw.description, `operations[${index}].description`, 256, false) || undefined,
    };
  });
}

function readString(value: unknown, name: string, max: number, required: boolean): string {
  if (value === undefined) {
    if (required) throw new Error(`rednode.${name} is required`);
    return "";
  }
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new Error(`rednode.${name} must be a non-empty string up to ${max} characters`);
  return value.trim();
}

function readEnv(value: string | undefined, name: string, max: number): string {
  const result = value?.trim() ?? "";
  if (result.length > max) throw new Error(`${name} exceeds ${max} characters`);
  return result;
}

function readInteger(value: unknown, name: string, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new Error(`rednode.${name} must be an integer between ${min} and ${max}`);
  return value as number;
}

function validateApiPath(value: string): string {
  if (!value.startsWith("/ark/open_api/") || value.includes("?") || value.includes("#") || value.includes("//")
    || value.split("/").some((part) => part === "." || part === "..")
    || !/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/{\}-]+$/.test(value)) {
    throw new Error("rednode operation apiPath must be a safe /ark/open_api/ path template");
  }
  for (const match of value.matchAll(/\{([^}]+)\}/g)) {
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(match[1] ?? "")) throw new Error("rednode apiPath placeholder is invalid");
  }
  return value;
}

function validateBaseUrl(value: string, environment: "production" | "sandbox"): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("rednode.apiBaseUrl must be a valid URL"); }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  const officialSandbox = environment === "sandbox" && url.origin === SANDBOX_BASE;
  if (url.protocol !== "https:" && !(url.protocol === "http:" && (loopback || officialSandbox))) {
    throw new Error("rednode.apiBaseUrl must use HTTPS; HTTP is allowed only for the official sandbox or loopback tests");
  }
  if (url.username || url.password || url.search || url.hash) throw new Error("rednode.apiBaseUrl must not contain credentials, query or fragment");
  return url.toString().replace(/\/$/, "");
}
