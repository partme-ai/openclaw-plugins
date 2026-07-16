/**
 * @fileoverview 微信 iPad 外部桥接的配置模式、默认值合并和安全校验。
 *
 * 配置解析采用 fail-closed 策略：拒绝未知字段、越界数值和携带凭据的 URL；远程服务只允许
 * WSS/HTTPS，明文 WS/HTTP 仅可用于本机回环开发。启用插件还必须显式确认非官方协议风险，
 * 启用群聊则必须配置白名单或再次明确允许全部群。
 */
import { DEFAULT_CONFIG, type WechatIpadConfig } from "./types.js";

/** 允许使用明文协议进行本地开发的回环主机集合。 */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** 供 OpenClaw 配置系统展示和预校验的 JSON Schema。 */
export const WECHAT_IPAD_CONFIG_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    enabled: { type: "boolean", default: false },
    acknowledgeUnofficialProtocolRisk: { type: "boolean", default: false },
    required: { type: "boolean", default: true },
    serviceUrl: { type: "string", format: "uri", default: DEFAULT_CONFIG.serviceUrl },
    apiUrl: { type: "string", format: "uri", default: DEFAULT_CONFIG.apiUrl },
    reconnect: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean", default: true },
        initialDelayMs: { type: "integer", minimum: 100, maximum: 60_000, default: 1000 },
        maxDelayMs: { type: "integer", minimum: 1000, maximum: 300_000, default: 30_000 },
        maxRetries: { type: "integer", minimum: 0, maximum: 10_000, default: 30 },
        jitterRatio: { type: "number", minimum: 0, maximum: 1, default: 0.2 },
      },
    },
    auth: {
      type: "object",
      additionalProperties: false,
      properties: { token: { type: "string", minLength: 1 } },
    },
    network: {
      type: "object",
      additionalProperties: false,
      properties: {
        connectTimeoutMs: { type: "integer", minimum: 100, maximum: 120_000, default: 10_000 },
        requestTimeoutMs: { type: "integer", minimum: 100, maximum: 120_000, default: 10_000 },
        maxResponseBytes: { type: "integer", minimum: 1024, maximum: 10_485_760, default: 1_048_576 },
        maxEventBytes: { type: "integer", minimum: 1024, maximum: 10_485_760, default: 1_048_576 },
        heartbeatIntervalMs: { type: "integer", minimum: 1000, maximum: 300_000, default: 30_000 },
        pongTimeoutMs: { type: "integer", minimum: 500, maximum: 120_000, default: 10_000 },
      },
    },
    message: {
      type: "object",
      additionalProperties: false,
      properties: {
        handleGroup: { type: "boolean", default: false },
        groupWhitelist: { type: "array", items: { type: "string", minLength: 1 }, default: [] },
        allowAllGroups: { type: "boolean", default: false },
        ignoreSelf: { type: "boolean", default: true },
        maxTextChars: { type: "integer", minimum: 1, maximum: 100_000, default: 20_000 },
      },
    },
  },
} as const;

function assertAllowedKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new Error(`wechat-ipad: unknown ${path} field: ${unknown[0]}`);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number, name: string): number {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isInteger(resolved) || (resolved as number) < min || (resolved as number) > max) {
    throw new Error(`wechat-ipad: ${name} must be an integer between ${min} and ${max}`);
  }
  return resolved as number;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number, name: string): number {
  const resolved = value === undefined ? fallback : value;
  if (typeof resolved !== "number" || !Number.isFinite(resolved) || resolved < min || resolved > max) {
    throw new Error(`wechat-ipad: ${name} must be between ${min} and ${max}`);
  }
  return resolved;
}

function validateEndpoint(raw: unknown, fallback: string, kind: "websocket" | "http"): string {
  const value = typeof raw === "string" && raw.trim() ? raw.trim() : fallback;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`wechat-ipad: invalid ${kind} endpoint`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`wechat-ipad: ${kind} endpoint must not contain credentials, query, or fragment`);
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  const allowed = kind === "websocket"
    ? (url.protocol === "wss:" || (local && url.protocol === "ws:"))
    : (url.protocol === "https:" || (local && url.protocol === "http:"));
  if (!allowed) {
    throw new Error(`wechat-ipad: remote ${kind} endpoint must use ${kind === "websocket" ? "wss" : "https"}`);
  }
  return url.toString().replace(/\/$/, "");
}

function stringArray(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new Error("wechat-ipad: message.groupWhitelist must contain non-empty strings");
  }
  return [...new Set(value.map((entry) => entry.trim()))];
}

/** 从 OpenClaw 全局配置中读取 `channels.wechat-ipad` 段。 */
export function getWechatIpadSection(globalConfig: Record<string, unknown>): Record<string, unknown> {
  const channels = objectValue(globalConfig.channels);
  return objectValue(channels["wechat-ipad"]);
}

/**
 * 合并默认值、环境变量和用户配置，并执行封闭式安全校验。
 * Token 优先取显式 `auth.token`，为空时才读取 `WECHAT_IPAD_BRIDGE_TOKEN`。
 */
export function resolveWechatIpadConfig(
  input: Record<string, unknown> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): WechatIpadConfig {
  const raw = objectValue(input);
  const reconnect = objectValue(raw.reconnect);
  const auth = objectValue(raw.auth);
  const network = objectValue(raw.network);
  const message = objectValue(raw.message);
  assertAllowedKeys(raw, ["enabled", "acknowledgeUnofficialProtocolRisk", "required", "serviceUrl", "apiUrl", "reconnect", "auth", "network", "message"], "config");
  assertAllowedKeys(reconnect, ["enabled", "initialDelayMs", "maxDelayMs", "maxRetries", "jitterRatio"], "reconnect");
  assertAllowedKeys(auth, ["token"], "auth");
  assertAllowedKeys(network, ["connectTimeoutMs", "requestTimeoutMs", "maxResponseBytes", "maxEventBytes", "heartbeatIntervalMs", "pongTimeoutMs"], "network");
  assertAllowedKeys(message, ["handleGroup", "groupWhitelist", "allowAllGroups", "ignoreSelf", "maxTextChars"], "message");
  const enabled = booleanValue(raw.enabled, DEFAULT_CONFIG.enabled);
  const acknowledgeUnofficialProtocolRisk = booleanValue(
    raw.acknowledgeUnofficialProtocolRisk,
    DEFAULT_CONFIG.acknowledgeUnofficialProtocolRisk,
  );

  if (enabled && !acknowledgeUnofficialProtocolRisk) {
    throw new Error(
      "wechat-ipad: enabled=true requires acknowledgeUnofficialProtocolRisk=true",
    );
  }

  const handleGroup = booleanValue(message.handleGroup, DEFAULT_CONFIG.message.handleGroup);
  const allowAllGroups = booleanValue(message.allowAllGroups, DEFAULT_CONFIG.message.allowAllGroups);
  const groupWhitelist = stringArray(message.groupWhitelist);
  if (enabled && handleGroup && !allowAllGroups && groupWhitelist.length === 0) {
    throw new Error(
      "wechat-ipad: group messages require a non-empty groupWhitelist or allowAllGroups=true",
    );
  }

  const tokenValue = typeof auth.token === "string" ? auth.token.trim() : "";
  const envToken = env.WECHAT_IPAD_BRIDGE_TOKEN?.trim() ?? "";

  return {
    enabled,
    acknowledgeUnofficialProtocolRisk,
    required: booleanValue(raw.required, DEFAULT_CONFIG.required),
    serviceUrl: validateEndpoint(raw.serviceUrl, DEFAULT_CONFIG.serviceUrl, "websocket"),
    apiUrl: validateEndpoint(raw.apiUrl, DEFAULT_CONFIG.apiUrl, "http"),
    reconnect: {
      enabled: booleanValue(reconnect.enabled, DEFAULT_CONFIG.reconnect.enabled),
      initialDelayMs: boundedInteger(reconnect.initialDelayMs, DEFAULT_CONFIG.reconnect.initialDelayMs, 100, 60_000, "reconnect.initialDelayMs"),
      maxDelayMs: boundedInteger(reconnect.maxDelayMs, DEFAULT_CONFIG.reconnect.maxDelayMs, 1000, 300_000, "reconnect.maxDelayMs"),
      maxRetries: boundedInteger(reconnect.maxRetries, DEFAULT_CONFIG.reconnect.maxRetries, 0, 10_000, "reconnect.maxRetries"),
      jitterRatio: boundedNumber(reconnect.jitterRatio, DEFAULT_CONFIG.reconnect.jitterRatio, 0, 1, "reconnect.jitterRatio"),
    },
    auth: { token: tokenValue || envToken || undefined },
    network: {
      connectTimeoutMs: boundedInteger(network.connectTimeoutMs, DEFAULT_CONFIG.network.connectTimeoutMs, 100, 120_000, "network.connectTimeoutMs"),
      requestTimeoutMs: boundedInteger(network.requestTimeoutMs, DEFAULT_CONFIG.network.requestTimeoutMs, 100, 120_000, "network.requestTimeoutMs"),
      maxResponseBytes: boundedInteger(network.maxResponseBytes, DEFAULT_CONFIG.network.maxResponseBytes, 1024, 10 * 1024 * 1024, "network.maxResponseBytes"),
      maxEventBytes: boundedInteger(network.maxEventBytes, DEFAULT_CONFIG.network.maxEventBytes, 1024, 10 * 1024 * 1024, "network.maxEventBytes"),
      heartbeatIntervalMs: boundedInteger(network.heartbeatIntervalMs, DEFAULT_CONFIG.network.heartbeatIntervalMs, 1000, 300_000, "network.heartbeatIntervalMs"),
      pongTimeoutMs: boundedInteger(network.pongTimeoutMs, DEFAULT_CONFIG.network.pongTimeoutMs, 500, 120_000, "network.pongTimeoutMs"),
    },
    message: {
      handleGroup,
      groupWhitelist,
      allowAllGroups,
      ignoreSelf: booleanValue(message.ignoreSelf, DEFAULT_CONFIG.message.ignoreSelf),
      maxTextChars: boundedInteger(message.maxTextChars, DEFAULT_CONFIG.message.maxTextChars, 1, 100_000, "message.maxTextChars"),
    },
  };
}
