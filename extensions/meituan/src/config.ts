/**
 * @fileoverview 美团 OpenAPI 插件的配置可信边界。
 *
 * 本模块把 OpenClaw 中的未受信任原始配置与环境变量收敛为运行时可用配置：
 *
 * - 认证信息只接受显式配置或约定环境变量，并限制长度与开发者编号格式；
 * - `operations` 是允许 Agent 调用的 API 白名单，而不是任意路径转发器；
 * - 官方域名默认锁定，只有显式确认后才能接入受信任的 HTTPS 代理；
 * - 超时、请求/响应体和分钟级调用量均设置硬边界，避免配置错误放大外部调用风险。
 *
 * 配置 Schema 负责宿主加载时的提示，本文件仍执行完整运行时校验，以覆盖测试、直接调用和
 * 未来 OpenClaw 加载路径变化。未知字段一律失败，防止安全开关拼写错误后被静默忽略。
 */
import type { MeituanAccountCredential, MeituanOperation, MeituanPluginConfig } from "./types.js";

const DEFAULT_BASE_URL = "https://api-open-cater.meituan.com";
const CONFIG_KEYS = new Set([
  "enabled",
  "developerId",
  "signKey",
  "appAuthToken",
  "accounts",
  "requireAccountBinding",
  "apiBaseUrl",
  "version",
  "operations",
  "requestTimeoutMs",
  "maxRequestBytes",
  "maxResponseBytes",
  "maxToolResultBytes",
  "maxRequestsPerMinute",
  "maxConcurrentRequests",
  "readRetryMaxAttempts",
  "retryInitialDelayMs",
  "retryMaxDelayMs",
  "retryJitterRatio",
  "requireWriteIdempotency",
  "idempotencyTtlMs",
  "maxIdempotencyEntries",
  "allowCustomApiBaseUrl",
  "ownerOnly",
]);
const ACCOUNT_KEYS = new Set(["accountId", "appAuthToken", "appAuthTokenEnv"]);
const OPERATION_KEYS = new Set([
  "name",
  "description",
  "apiPath",
  "businessId",
  "requiresAuth",
  "riskLevel",
  "successCodes",
  "idempotencyBizField",
]);

/**
 * 严格解析 Meituan 配置；未知字段直接失败，避免 ownerOnly、鉴权或请求边界拼写错误后
 * 被静默忽略。Schema 与运行时双重校验可覆盖正常加载、直接调用和未来宿主变更。
 */
export function resolveMeituanConfig(
  raw: Record<string, unknown> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): MeituanPluginConfig | null {
  if (raw !== undefined && (!raw || typeof raw !== "object" || Array.isArray(raw))) {
    throw new Error("meituan config must be an object");
  }
  const config = raw ?? {};
  assertAllowedKeys(config, CONFIG_KEYS, "meituan");
  assertOptionalBoolean(config.enabled, "enabled");
  if (config.enabled !== true) return null;

  const developerId =
    readString(config.developerId, "developerId", 32, false) ||
    readEnv(env.MEITUAN_DEVELOPER_ID, "MEITUAN_DEVELOPER_ID", 32);
  if (!/^\d{1,19}$/.test(developerId)) {
    throw new Error("meituan.developerId must contain 1 to 19 digits");
  }
  const signKey =
    readString(config.signKey, "signKey", 512, false) ||
    readEnv(env.MEITUAN_SIGN_KEY, "MEITUAN_SIGN_KEY", 512);
  if (!signKey)
    throw new Error("meituan.signKey is required (or set MEITUAN_SIGN_KEY)");
  const appAuthToken =
    readString(config.appAuthToken, "appAuthToken", 2048, false) ||
    readEnv(env.MEITUAN_APP_AUTH_TOKEN, "MEITUAN_APP_AUTH_TOKEN", 2048) ||
    undefined;
  const accounts = readAccounts(config.accounts, env);

  assertOptionalBoolean(config.allowCustomApiBaseUrl, "allowCustomApiBaseUrl");
  assertOptionalBoolean(config.ownerOnly, "ownerOnly");
  assertOptionalBoolean(config.requireAccountBinding, "requireAccountBinding");
  assertOptionalBoolean(config.requireWriteIdempotency, "requireWriteIdempotency");
  const allowCustomApiBaseUrl = config.allowCustomApiBaseUrl === true;
  const requireWriteIdempotency = config.requireWriteIdempotency !== false;
  const version = readString(config.version, "version", 16, false) || "2";
  if (!/^[A-Za-z0-9._-]{1,16}$/.test(version)) {
    throw new Error("meituan.version contains unsupported characters");
  }

  const maxResponseBytes = readInteger(
    config.maxResponseBytes,
    "maxResponseBytes",
    1_024,
    5_242_880,
    1_048_576,
  );
  // 上游响应边界保护进程；默认更小的 Tool 边界保护 Agent 上下文。
  const maxToolResultBytes = readInteger(
    config.maxToolResultBytes,
    "maxToolResultBytes",
    1_024,
    1_048_576,
    Math.min(262_144, maxResponseBytes),
  );
  if (maxToolResultBytes > maxResponseBytes) {
    throw new Error("meituan.maxToolResultBytes must not exceed maxResponseBytes");
  }

  const retryInitialDelayMs = readInteger(
    config.retryInitialDelayMs,
    "retryInitialDelayMs",
    0,
    10_000,
    250,
  );
  const retryMaxDelayMs = readInteger(
    config.retryMaxDelayMs,
    "retryMaxDelayMs",
    retryInitialDelayMs,
    60_000,
    2_000,
  );

  return {
    enabled: true,
    developerId,
    signKey,
    appAuthToken,
    accounts,
    requireAccountBinding:
      config.requireAccountBinding === undefined
        ? accounts.length > 0
        : config.requireAccountBinding === true,
    accountBindingMatched: true,
    apiBaseUrl: validateBaseUrl(
      readString(config.apiBaseUrl, "apiBaseUrl", 2048, false) ||
        DEFAULT_BASE_URL,
      allowCustomApiBaseUrl,
    ),
    version,
    operations: readOperations(config.operations, requireWriteIdempotency),
    requestTimeoutMs: readInteger(
      config.requestTimeoutMs,
      "requestTimeoutMs",
      500,
      60_000,
      10_000,
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
    maxConcurrentRequests: readInteger(
      config.maxConcurrentRequests,
      "maxConcurrentRequests",
      1,
      128,
      8,
    ),
    readRetryMaxAttempts: readInteger(
      config.readRetryMaxAttempts,
      "readRetryMaxAttempts",
      1,
      4,
      2,
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
    requireWriteIdempotency,
    idempotencyTtlMs: readInteger(
      config.idempotencyTtlMs,
      "idempotencyTtlMs",
      60_000,
      604_800_000,
      86_400_000,
    ),
    maxIdempotencyEntries: readInteger(
      config.maxIdempotencyEntries,
      "maxIdempotencyEntries",
      1,
      100_000,
      10_000,
    ),
    allowCustomApiBaseUrl,
    ownerOnly: config.ownerOnly !== false,
  };
}

/**
 * 多门店 Token 只按运行时受信任的 `agentAccountId` 选择，不接受 Agent Tool 参数指定。
 * 强制绑定时未匹配账号会移除全局 Token，使需要鉴权的 operation 在网络请求前失败关闭。
 */
export function bindMeituanAccount(
  config: MeituanPluginConfig,
  agentAccountId: string | undefined,
): MeituanPluginConfig {
  if (config.accounts.length === 0) return config;
  const account = config.accounts.find((candidate) => candidate.accountId === agentAccountId);
  if (account) {
    return {
      ...config,
      appAuthToken: account.appAuthToken,
      accounts: [],
      accountBindingMatched: true,
    };
  }
  return {
    ...config,
    appAuthToken: config.requireAccountBinding ? undefined : config.appAuthToken,
    accounts: [],
    accountBindingMatched: !config.requireAccountBinding,
  };
}

function readAccounts(
  value: unknown,
  env: NodeJS.ProcessEnv,
): MeituanAccountCredential[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new Error("meituan.accounts must contain between 1 and 100 entries");
  }
  const ids = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`meituan.accounts[${index}] must be an object`);
    }
    const account = item as Record<string, unknown>;
    assertAllowedKeys(account, ACCOUNT_KEYS, `meituan.accounts[${index}]`);
    const accountId = readString(account.accountId, `accounts[${index}].accountId`, 128, true);
    if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(accountId)) {
      throw new Error(`meituan.accounts[${index}].accountId contains unsupported characters`);
    }
    if (ids.has(accountId)) throw new Error(`meituan accountId is duplicated: ${accountId}`);
    ids.add(accountId);
    const inlineToken = readString(account.appAuthToken, `accounts[${index}].appAuthToken`, 2_048, false);
    const envName = readString(account.appAuthTokenEnv, `accounts[${index}].appAuthTokenEnv`, 128, false);
    if (inlineToken && envName) {
      throw new Error(`meituan.accounts[${index}] must use only one appAuthToken source`);
    }
    if (envName && !/^[A-Z_][A-Z0-9_]{0,127}$/u.test(envName)) {
      throw new Error(`meituan.accounts[${index}].appAuthTokenEnv must be an environment variable name`);
    }
    const appAuthToken = inlineToken || (envName ? readEnv(env[envName], envName, 2_048) : "");
    if (!appAuthToken) throw new Error(`meituan.accounts[${index}] requires appAuthToken or appAuthTokenEnv`);
    return { accountId, appAuthToken };
  });
}

function readOperations(
  value: unknown,
  requireWriteIdempotency: boolean,
): MeituanOperation[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new Error(
      "meituan.operations must contain between 1 and 100 operations",
    );
  }
  const names = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`meituan.operations[${index}] must be an object`);
    }
    const operation = item as Record<string, unknown>;
    assertAllowedKeys(
      operation,
      OPERATION_KEYS,
      `meituan.operations[${index}]`,
    );
    const name = readString(
      operation.name,
      `operations[${index}].name`,
      64,
      true,
    );
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(name)) {
      throw new Error(
        `meituan.operations[${index}].name must use lowercase letters, digits, _ or -`,
      );
    }
    if (names.has(name))
      throw new Error(`meituan operation name is duplicated: ${name}`);
    names.add(name);
    const apiPath = validateApiPath(
      readString(operation.apiPath, `operations[${index}].apiPath`, 256, true),
    );
    const businessId = readInteger(
      operation.businessId,
      `operations[${index}].businessId`,
      1,
      2_147_483_647,
    );
    const riskLevel = operation.riskLevel ?? "write";
    if (riskLevel !== "read" && riskLevel !== "write") {
      throw new Error(
        `meituan.operations[${index}].riskLevel must be read or write`,
      );
    }
    assertOptionalBoolean(
      operation.requiresAuth,
      `operations[${index}].requiresAuth`,
    );
    const idempotencyBizField =
      readString(
        operation.idempotencyBizField,
        `operations[${index}].idempotencyBizField`,
        128,
        false,
      ) || undefined;
    if (
      idempotencyBizField &&
      !/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/u.test(idempotencyBizField)
    ) {
      throw new Error(
        `meituan.operations[${index}].idempotencyBizField must name one top-level biz field`,
      );
    }
    if (riskLevel === "read" && idempotencyBizField) {
      throw new Error(
        `meituan.operations[${index}].idempotencyBizField is only valid for write operations`,
      );
    }
    if (
      riskLevel === "write" &&
      requireWriteIdempotency &&
      !idempotencyBizField
    ) {
      throw new Error(
        `meituan.operations[${index}] write operation requires idempotencyBizField`,
      );
    }
    return {
      name,
      apiPath,
      businessId,
      description:
        readString(
          operation.description,
          `operations[${index}].description`,
          256,
          false,
        ) || undefined,
      requiresAuth: operation.requiresAuth !== false,
      riskLevel,
      successCodes: readSuccessCodes(operation.successCodes, index),
      idempotencyBizField,
    };
  });
}

/** 安全开关禁止字符串/数字真值隐式转换，拼错类型必须在启动阶段失败。 */
function assertOptionalBoolean(value: unknown, name: string): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw new Error(`meituan.${name} must be a boolean`);
  }
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

/** 成功码由具体业务文档决定；缺省使用 MTOp 通用 `OP_SUCCESS`。 */
function readSuccessCodes(value: unknown, index: number): string[] {
  if (value === undefined) return ["OP_SUCCESS"];
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) {
    throw new Error(
      `meituan.operations[${index}].successCodes must contain 1 to 16 entries`,
    );
  }
  const codes = value.map((code) => {
    if (typeof code !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(code)) {
      throw new Error(
        `meituan.operations[${index}].successCodes contains an invalid code`,
      );
    }
    return code;
  });
  return [...new Set(codes)];
}

function readString(
  value: unknown,
  name: string,
  maxLength: number,
  required: boolean,
): string {
  if (value === undefined) {
    if (required) throw new Error(`meituan.${name} is required`);
    return "";
  }
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > maxLength ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(
      `meituan.${name} must be a non-empty string up to ${maxLength} characters`,
    );
  }
  return value.trim();
}

function readEnv(
  value: string | undefined,
  name: string,
  maxLength: number,
): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length > maxLength)
    throw new Error(`${name} exceeds ${maxLength} characters`);
  if (/[\u0000-\u001f\u007f]/u.test(trimmed))
    throw new Error(`${name} must not contain control characters`);
  return trimmed;
}

function readInteger(
  value: unknown,
  name: string,
  min: number,
  max: number,
  fallback?: number,
): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (
    !Number.isInteger(value) ||
    (value as number) < min ||
    (value as number) > max
  ) {
    throw new Error(
      `meituan.${name} must be an integer between ${min} and ${max}`,
    );
  }
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
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`meituan.${name} must be a number between ${min} and ${max}`);
  }
  return value;
}

function validateApiPath(value: string): string {
  if (
    !/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/.test(value) ||
    value.includes("//") ||
    value.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(
      "meituan operation apiPath must be an absolute path without query, fragment or traversal",
    );
  }
  return value;
}

function validateBaseUrl(
  value: string,
  allowCustomApiBaseUrl: boolean,
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("meituan.apiBaseUrl must be a valid URL");
  }
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error(
      "meituan.apiBaseUrl must use HTTPS (HTTP is allowed only for loopback tests)",
    );
  }
  if (url.origin !== DEFAULT_BASE_URL && !loopback && !allowCustomApiBaseUrl) {
    throw new Error(
      "meituan.apiBaseUrl must use the official host; set allowCustomApiBaseUrl=true only for an explicitly trusted HTTPS proxy",
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
      "meituan.apiBaseUrl must be an origin without credentials, path, query or fragment",
    );
  }
  return url.toString().replace(/\/$/, "");
}
