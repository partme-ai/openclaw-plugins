import type { MeituanOperation, MeituanPluginConfig } from "./types.js";

const DEFAULT_BASE_URL = "https://api-open-cater.meituan.com";

export function resolveMeituanConfig(
  raw: Record<string, unknown> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): MeituanPluginConfig | null {
  const config = raw ?? {};
  if (config.enabled !== true) return null;

  const developerId = readString(config.developerId, "developerId", 32, false)
    || readEnv(env.MEITUAN_DEVELOPER_ID, "MEITUAN_DEVELOPER_ID", 32);
  if (!/^\d{1,19}$/.test(developerId)) {
    throw new Error("meituan.developerId must contain 1 to 19 digits");
  }
  const signKey = readString(config.signKey, "signKey", 512, false)
    || readEnv(env.MEITUAN_SIGN_KEY, "MEITUAN_SIGN_KEY", 512);
  if (!signKey) throw new Error("meituan.signKey is required (or set MEITUAN_SIGN_KEY)");
  const appAuthToken = readString(config.appAuthToken, "appAuthToken", 2048, false)
    || readEnv(env.MEITUAN_APP_AUTH_TOKEN, "MEITUAN_APP_AUTH_TOKEN", 2048)
    || undefined;

  return {
    enabled: true,
    developerId,
    signKey,
    appAuthToken,
    apiBaseUrl: validateBaseUrl(readString(config.apiBaseUrl, "apiBaseUrl", 2048, false) || DEFAULT_BASE_URL),
    version: readString(config.version, "version", 16, false) || "2",
    operations: readOperations(config.operations),
    requestTimeoutMs: readInteger(config.requestTimeoutMs, "requestTimeoutMs", 500, 60_000, 10_000),
    maxRequestBytes: readInteger(config.maxRequestBytes, "maxRequestBytes", 256, 1_048_576, 65_536),
    maxResponseBytes: readInteger(config.maxResponseBytes, "maxResponseBytes", 1_024, 5_242_880, 1_048_576),
    maxRequestsPerMinute: readInteger(config.maxRequestsPerMinute, "maxRequestsPerMinute", 1, 10_000, 60),
    ownerOnly: config.ownerOnly !== false,
  };
}

function readOperations(value: unknown): MeituanOperation[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new Error("meituan.operations must contain between 1 and 100 operations");
  }
  const names = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`meituan.operations[${index}] must be an object`);
    }
    const operation = item as Record<string, unknown>;
    const name = readString(operation.name, `operations[${index}].name`, 64, true);
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(name)) {
      throw new Error(`meituan.operations[${index}].name must use lowercase letters, digits, _ or -`);
    }
    if (names.has(name)) throw new Error(`meituan operation name is duplicated: ${name}`);
    names.add(name);
    const apiPath = validateApiPath(readString(operation.apiPath, `operations[${index}].apiPath`, 256, true));
    const businessId = readInteger(operation.businessId, `operations[${index}].businessId`, 1, 2_147_483_647);
    return {
      name,
      apiPath,
      businessId,
      description: readString(operation.description, `operations[${index}].description`, 256, false) || undefined,
      requiresAuth: operation.requiresAuth !== false,
    };
  });
}

function readString(value: unknown, name: string, maxLength: number, required: boolean): string {
  if (value === undefined) {
    if (required) throw new Error(`meituan.${name} is required`);
    return "";
  }
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new Error(`meituan.${name} must be a non-empty string up to ${maxLength} characters`);
  }
  return value.trim();
}

function readEnv(value: string | undefined, name: string, maxLength: number): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length > maxLength) throw new Error(`${name} exceeds ${maxLength} characters`);
  return trimmed;
}

function readInteger(value: unknown, name: string, min: number, max: number, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`meituan.${name} must be an integer between ${min} and ${max}`);
  }
  return value as number;
}

function validateApiPath(value: string): string {
  if (!/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/.test(value)
    || value.includes("//") || value.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new Error("meituan operation apiPath must be an absolute path without query, fragment or traversal");
  }
  return value;
}

function validateBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("meituan.apiBaseUrl must be a valid URL");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("meituan.apiBaseUrl must use HTTPS (HTTP is allowed only for loopback tests)");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("meituan.apiBaseUrl must not contain credentials, query or fragment");
  }
  return url.toString().replace(/\/$/, "");
}
