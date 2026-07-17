/**
 * @fileoverview 小红书 Rednode 开放平台插件的配置可信边界。
 *
 * 本模块将 OpenClaw 原始配置和环境变量解析为可执行配置，并在任何网络请求发生前完成：
 *
 * - AppKey/AppSecret 的来源与长度校验；
 * - production/sandbox 环境和官方服务地址绑定；
 * - Agent 可调用 operation、HTTP 方法、路径模板及占位符白名单校验；
 * - 请求体、响应体、超时、限流和只读重试参数的容量约束；
 * - 自定义 HTTPS 代理与 owner-only 调用边界的显式确认。
 *
 * 这里故意不提供“任意 URL + 任意 method”透传能力。配置 Schema 之外再次 fail-fast 校验，
 * 是为了避免直接调用、测试或宿主升级绕开安全约束。
 */
import type { RednodeOperation, RednodePluginConfig } from "./types.js";

const PRODUCTION_BASE = "https://ark.xiaohongshu.com";
const SANDBOX_BASE = "http://flssandbox.xiaohongshu.com";
const CONFIG_KEYS = new Set([
  "enabled",
  "appKey",
  "appSecret",
  "environment",
  "apiBaseUrl",
  "operations",
  "requestTimeoutMs",
  "maxRequestBytes",
  "maxResponseBytes",
  "maxToolResultBytes",
  "maxRequestsPerMinute",
  "getRetryMaxAttempts",
  "retryInitialDelayMs",
  "retryMaxDelayMs",
  "retryJitterRatio",
  "allowCustomApiBaseUrl",
  "ownerOnly",
]);
const OPERATION_KEYS = new Set(["name", "method", "apiPath", "description"]);

/**
 * 解析并严格校验 Rednode 配置。
 *
 * Schema 只覆盖正常 OpenClaw 加载路径；这里再次执行运行时校验，使测试、直接 API 调用和
 * 未来宿主变更也保持 fail-fast。未知字段不会被静默忽略，避免安全开关拼写错误后按默认值运行。
 */
export function resolveRednodeConfig(
  raw: Record<string, unknown> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): RednodePluginConfig | null {
  if (raw !== undefined && (!raw || typeof raw !== "object" || Array.isArray(raw))) {
    throw new Error("rednode config must be an object");
  }
  const config = raw ?? {};
  assertAllowedKeys(config, CONFIG_KEYS, "rednode");
  assertOptionalBoolean(config.enabled, "enabled");
  if (config.enabled !== true) return null;
  const appKey =
    readString(config.appKey, "appKey", 256, false) ||
    readEnv(env.XHS_APP_KEY, "XHS_APP_KEY", 256);
  const appSecret =
    readString(config.appSecret, "appSecret", 512, false) ||
    readEnv(env.XHS_APP_SECRET, "XHS_APP_SECRET", 512);
  if (!appKey)
    throw new Error("rednode.appKey is required (or set XHS_APP_KEY)");
  if (!appSecret)
    throw new Error("rednode.appSecret is required (or set XHS_APP_SECRET)");
  const environment =
    config.environment === undefined ? "production" : config.environment;
  if (environment !== "production" && environment !== "sandbox") {
    throw new Error("rednode.environment must be production or sandbox");
  }
  const defaultBase =
    environment === "sandbox" ? SANDBOX_BASE : PRODUCTION_BASE;
  const retryInitialDelayMs = readInteger(
    config.retryInitialDelayMs,
    "retryInitialDelayMs",
    50,
    10_000,
    250,
  );
  const retryMaxDelayMs = readInteger(
    config.retryMaxDelayMs,
    "retryMaxDelayMs",
    50,
    60_000,
    2_000,
  );
  if (retryMaxDelayMs < retryInitialDelayMs) {
    throw new Error("rednode.retryMaxDelayMs must be >= retryInitialDelayMs");
  }
  const allowCustomApiBaseUrl = readBoolean(
    config.allowCustomApiBaseUrl,
    "allowCustomApiBaseUrl",
    false,
  );
  const maxResponseBytes = readInteger(
    config.maxResponseBytes,
    "maxResponseBytes",
    1_024,
    10_485_760,
    2_097_152,
  );
  const maxToolResultBytes = readInteger(
    config.maxToolResultBytes,
    "maxToolResultBytes",
    1_024,
    1_048_576,
    Math.min(262_144, maxResponseBytes),
  );
  if (maxToolResultBytes > maxResponseBytes) {
    throw new Error("rednode.maxToolResultBytes must not exceed maxResponseBytes");
  }
  return {
    enabled: true,
    appKey,
    appSecret,
    environment,
    apiBaseUrl: validateBaseUrl(
      readString(config.apiBaseUrl, "apiBaseUrl", 2048, false) || defaultBase,
      environment,
      allowCustomApiBaseUrl,
    ),
    operations: readOperations(config.operations),
    requestTimeoutMs: readInteger(
      config.requestTimeoutMs,
      "requestTimeoutMs",
      500,
      60_000,
      30_000,
    ),
    maxRequestBytes: readInteger(
      config.maxRequestBytes,
      "maxRequestBytes",
      256,
      1_048_576,
      65_536,
    ),
    maxResponseBytes,
    maxToolResultBytes,
    maxRequestsPerMinute: readInteger(
      config.maxRequestsPerMinute,
      "maxRequestsPerMinute",
      1,
      10_000,
      60,
    ),
    getRetryMaxAttempts: readInteger(
      config.getRetryMaxAttempts,
      "getRetryMaxAttempts",
      1,
      5,
      3,
    ),
    retryInitialDelayMs,
    retryMaxDelayMs,
    retryJitterRatio: readNumber(
      config.retryJitterRatio,
      "retryJitterRatio",
      0,
      1,
      0.2,
    ),
    allowCustomApiBaseUrl,
    ownerOnly: readBoolean(config.ownerOnly, "ownerOnly", true),
  };
}

/**
 * 严格读取安全开关。不能使用 `value === true` 或 `value !== false` 静默吞掉字符串，
 * 否则 YAML/环境拼装错误可能意外关闭 owner-only，或错误放行自定义凭据目标。
 */
function readBoolean(
  value: unknown,
  name: string,
  fallback: boolean,
): boolean {
  if (value === undefined) return fallback;
  assertOptionalBoolean(value, name);
  return value as boolean;
}

function assertOptionalBoolean(value: unknown, name: string): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw new Error(`rednode.${name} must be a boolean`);
  }
}

function readOperations(value: unknown): RednodeOperation[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new Error(
      "rednode.operations must contain between 1 and 100 operations",
    );
  }
  const names = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error(`rednode.operations[${index}] must be an object`);
    const raw = item as Record<string, unknown>;
    assertAllowedKeys(raw, OPERATION_KEYS, `rednode.operations[${index}]`);
    const name = readString(raw.name, `operations[${index}].name`, 64, true);
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(name))
      throw new Error(`rednode.operations[${index}].name is invalid`);
    if (names.has(name))
      throw new Error(`rednode operation name is duplicated: ${name}`);
    names.add(name);
    const method = raw.method;
    if (method !== "GET" && method !== "POST" && method !== "PUT")
      throw new Error(`rednode.operations[${index}].method is invalid`);
    return {
      name,
      method,
      apiPath: validateApiPath(
        readString(raw.apiPath, `operations[${index}].apiPath`, 256, true),
      ),
      description:
        readString(
          raw.description,
          `operations[${index}].description`,
          256,
          false,
        ) || undefined,
    };
  });
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`${path} contains unknown field(s): ${unknown.join(", ")}`);
  }
}

function readString(
  value: unknown,
  name: string,
  max: number,
  required: boolean,
): string {
  if (value === undefined) {
    if (required) throw new Error(`rednode.${name} is required`);
    return "";
  }
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > max ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    throw new Error(
      `rednode.${name} must be a non-empty string up to ${max} characters`,
    );
  return value.trim();
}

function readEnv(value: string | undefined, name: string, max: number): string {
  const result = value?.trim() ?? "";
  if (result.length > max) throw new Error(`${name} exceeds ${max} characters`);
  if (/[\u0000-\u001f\u007f]/u.test(result))
    throw new Error(`${name} must not contain control characters`);
  return result;
}

function readInteger(
  value: unknown,
  name: string,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (
    !Number.isInteger(value) ||
    (value as number) < min ||
    (value as number) > max
  )
    throw new Error(
      `rednode.${name} must be an integer between ${min} and ${max}`,
    );
  return value as number;
}

function readNumber(
  value: unknown,
  name: string,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(
      `rednode.${name} must be a number between ${min} and ${max}`,
    );
  }
  return value;
}

function validateApiPath(value: string): string {
  if (
    !value.startsWith("/ark/open_api/") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes("//") ||
    value.split("/").some((part) => part === "." || part === "..") ||
    !/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/{\}-]+$/.test(value)
  ) {
    throw new Error(
      "rednode operation apiPath must be a safe /ark/open_api/ path template",
    );
  }
  for (const match of value.matchAll(/\{([^}]+)\}/g)) {
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(match[1] ?? ""))
      throw new Error("rednode apiPath placeholder is invalid");
  }
  return value;
}

function validateBaseUrl(
  value: string,
  environment: "production" | "sandbox",
  allowCustomApiBaseUrl: boolean,
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("rednode.apiBaseUrl must be a valid URL");
  }
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1";
  const officialOrigin =
    environment === "sandbox" ? SANDBOX_BASE : PRODUCTION_BASE;
  const official = url.origin === officialOrigin;
  const officialSandbox = environment === "sandbox" && official;
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && (loopback || officialSandbox))
  ) {
    throw new Error(
      "rednode.apiBaseUrl must use HTTPS; HTTP is allowed only for the official sandbox or loopback tests",
    );
  }
  if (!official && !loopback && !allowCustomApiBaseUrl) {
    throw new Error(
      "rednode.apiBaseUrl must use the official environment host; set allowCustomApiBaseUrl=true only for an explicitly trusted HTTPS proxy",
    );
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error(
      "rednode.apiBaseUrl must be an origin without credentials, path, query or fragment",
    );
  }
  return url.toString().replace(/\/$/, "");
}
