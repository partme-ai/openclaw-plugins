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
    allowSplitBridgeHosts: { type: "boolean", default: false },
    serviceUrl: {
      type: "string",
      format: "uri",
      default: DEFAULT_CONFIG.serviceUrl,
    },
    apiUrl: { type: "string", format: "uri", default: DEFAULT_CONFIG.apiUrl },
    reconnect: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean", default: true },
        initialDelayMs: {
          type: "integer",
          minimum: 100,
          maximum: 60_000,
          default: 1000,
        },
        maxDelayMs: {
          type: "integer",
          minimum: 1000,
          maximum: 300_000,
          default: 30_000,
        },
        maxRetries: {
          type: "integer",
          minimum: 0,
          maximum: 10_000,
          default: 30,
        },
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
        connectTimeoutMs: {
          type: "integer",
          minimum: 100,
          maximum: 120_000,
          default: 10_000,
        },
        requestTimeoutMs: {
          type: "integer",
          minimum: 100,
          maximum: 120_000,
          default: 10_000,
        },
        maxResponseBytes: {
          type: "integer",
          minimum: 1024,
          maximum: 10_485_760,
          default: 1_048_576,
        },
        maxEventBytes: {
          type: "integer",
          minimum: 1024,
          maximum: 10_485_760,
          default: 1_048_576,
        },
        heartbeatIntervalMs: {
          type: "integer",
          minimum: 1000,
          maximum: 300_000,
          default: 30_000,
        },
        pongTimeoutMs: {
          type: "integer",
          minimum: 500,
          maximum: 120_000,
          default: 10_000,
        },
        stableConnectionMs: {
          type: "integer",
          minimum: 1000,
          maximum: 600_000,
          default: 60_000,
        },
      },
    },
    message: {
      type: "object",
      additionalProperties: false,
      properties: {
        dmPolicy: {
          type: "string",
          enum: ["allowlist", "open", "disabled"],
          default: "allowlist",
        },
        allowFrom: {
          type: "array",
          maxItems: 1000,
          items: { type: "string", minLength: 1, maxLength: 256 },
          default: [],
        },
        commandAllowFrom: {
          type: "array",
          maxItems: 1000,
          items: { type: "string", minLength: 1, maxLength: 256 },
          default: [],
        },
        handleGroup: { type: "boolean", default: false },
        groupWhitelist: {
          type: "array",
          maxItems: 1000,
          items: { type: "string", minLength: 1, maxLength: 256 },
          default: [],
        },
        allowAllGroups: { type: "boolean", default: false },
        ignoreSelf: { type: "boolean", default: true },
        maxTextChars: {
          type: "integer",
          minimum: 1,
          maximum: 100_000,
          default: 20_000,
        },
        maxPendingMessages: {
          type: "integer",
          minimum: 1,
          maximum: 10_000,
          default: 256,
        },
      },
    },
  },
} as const;

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0)
    throw new Error(`wechat-ipad: unknown ${path} field: ${unknown[0]}`);
}

function objectValue(value: unknown, path: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`wechat-ipad: ${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * 读取严格布尔配置。显式写入字符串 `"false"` 等错误类型时必须拒绝，不能静默回退，
 * 否则运维人员以为关闭的高风险能力可能仍按默认值运行。
 */
function booleanValue(
  value: unknown,
  fallback: boolean,
  name: string,
): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean")
    throw new Error(`wechat-ipad: ${name} must be a boolean`);
  return value;
}

function boundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  const resolved = value === undefined ? fallback : value;
  if (
    !Number.isInteger(resolved) ||
    (resolved as number) < min ||
    (resolved as number) > max
  ) {
    throw new Error(
      `wechat-ipad: ${name} must be an integer between ${min} and ${max}`,
    );
  }
  return resolved as number;
}

function boundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  const resolved = value === undefined ? fallback : value;
  if (
    typeof resolved !== "number" ||
    !Number.isFinite(resolved) ||
    resolved < min ||
    resolved > max
  ) {
    throw new Error(`wechat-ipad: ${name} must be between ${min} and ${max}`);
  }
  return resolved;
}

function validateEndpoint(
  raw: unknown,
  fallback: string,
  kind: "websocket" | "http",
): string {
  const value = typeof raw === "string" && raw.trim() ? raw.trim() : fallback;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`wechat-ipad: invalid ${kind} endpoint`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      `wechat-ipad: ${kind} endpoint must not contain credentials, query, or fragment`,
    );
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  const allowed =
    kind === "websocket"
      ? url.protocol === "wss:" || (local && url.protocol === "ws:")
      : url.protocol === "https:" || (local && url.protocol === "http:");
  if (!allowed) {
    throw new Error(
      `wechat-ipad: remote ${kind} endpoint must use ${kind === "websocket" ? "wss" : "https"}`,
    );
  }
  return url.toString().replace(/\/$/, "");
}

function identifierArray(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > 1000 ||
    value.some(
      (entry) =>
        typeof entry !== "string" ||
        !entry.trim() ||
        entry.trim().length > 256 ||
        /[\s/?#\u0000-\u001f\u007f]/u.test(entry.trim()),
    )
  ) {
    throw new Error(
      `wechat-ipad: ${name} must contain at most 1000 valid wxids`,
    );
  }
  return [...new Set(value.map((entry) => entry.trim()))];
}

function dmPolicyValue(
  value: unknown,
): WechatIpadConfig["message"]["dmPolicy"] {
  if (value === undefined) return DEFAULT_CONFIG.message.dmPolicy;
  if (value !== "allowlist" && value !== "open" && value !== "disabled") {
    throw new Error(
      "wechat-ipad: message.dmPolicy must be allowlist, open, or disabled",
    );
  }
  return value;
}

/** Header 凭据必须是有界、无控制字符的字符串，避免 Header 注入和异常日志泄密。 */
function tokenValue(value: unknown, name: string): string {
  if (value === undefined) return "";
  if (typeof value !== "string")
    throw new Error(`wechat-ipad: ${name} must be a string`);
  const token = value.trim();
  if (!token || token.length > 8192 || /[\u0000-\u001f\u007f]/u.test(token)) {
    throw new Error(
      `wechat-ipad: ${name} must be a non-empty token without control characters`,
    );
  }
  return token;
}

function endpointHostKey(value: string): string {
  const url = new URL(value);
  return LOCAL_HOSTS.has(url.hostname)
    ? "loopback"
    : url.hostname.toLowerCase();
}

function endpointIsRemote(value: string): boolean {
  return endpointHostKey(value) !== "loopback";
}

/** 从 OpenClaw 全局配置中读取 `channels.wechat-ipad` 段。 */
export function getWechatIpadSection(
  globalConfig: Record<string, unknown>,
): Record<string, unknown> {
  const channels = objectValue(globalConfig.channels, "channels");
  return objectValue(channels["wechat-ipad"], "channels.wechat-ipad");
}

/**
 * 合并默认值、环境变量和用户配置，并执行封闭式安全校验。
 * Token 优先取显式 `auth.token`，为空时才读取 `WECHAT_IPAD_BRIDGE_TOKEN`。
 */
export function resolveWechatIpadConfig(
  input: Record<string, unknown> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): WechatIpadConfig {
  const raw = objectValue(input, "config");
  const reconnect = objectValue(raw.reconnect, "reconnect");
  const auth = objectValue(raw.auth, "auth");
  const network = objectValue(raw.network, "network");
  const message = objectValue(raw.message, "message");
  assertAllowedKeys(
    raw,
    [
      "enabled",
      "acknowledgeUnofficialProtocolRisk",
      "required",
      "allowSplitBridgeHosts",
      "serviceUrl",
      "apiUrl",
      "reconnect",
      "auth",
      "network",
      "message",
    ],
    "config",
  );
  assertAllowedKeys(
    reconnect,
    ["enabled", "initialDelayMs", "maxDelayMs", "maxRetries", "jitterRatio"],
    "reconnect",
  );
  assertAllowedKeys(auth, ["token"], "auth");
  assertAllowedKeys(
    network,
    [
      "connectTimeoutMs",
      "requestTimeoutMs",
      "maxResponseBytes",
      "maxEventBytes",
      "heartbeatIntervalMs",
      "pongTimeoutMs",
      "stableConnectionMs",
    ],
    "network",
  );
  assertAllowedKeys(
    message,
    [
      "dmPolicy",
      "allowFrom",
      "commandAllowFrom",
      "handleGroup",
      "groupWhitelist",
      "allowAllGroups",
      "ignoreSelf",
      "maxTextChars",
      "maxPendingMessages",
    ],
    "message",
  );
  const enabled = booleanValue(raw.enabled, DEFAULT_CONFIG.enabled, "enabled");
  const acknowledgeUnofficialProtocolRisk = booleanValue(
    raw.acknowledgeUnofficialProtocolRisk,
    DEFAULT_CONFIG.acknowledgeUnofficialProtocolRisk,
    "acknowledgeUnofficialProtocolRisk",
  );

  if (enabled && !acknowledgeUnofficialProtocolRisk) {
    throw new Error(
      "wechat-ipad: enabled=true requires acknowledgeUnofficialProtocolRisk=true",
    );
  }

  const dmPolicy = dmPolicyValue(message.dmPolicy);
  const allowFrom = identifierArray(message.allowFrom, "message.allowFrom");
  const commandAllowFrom = identifierArray(
    message.commandAllowFrom,
    "message.commandAllowFrom",
  );
  if (enabled && dmPolicy === "allowlist" && allowFrom.length === 0) {
    throw new Error(
      "wechat-ipad: message.dmPolicy=allowlist requires a non-empty message.allowFrom",
    );
  }
  const handleGroup = booleanValue(
    message.handleGroup,
    DEFAULT_CONFIG.message.handleGroup,
    "message.handleGroup",
  );
  const allowAllGroups = booleanValue(
    message.allowAllGroups,
    DEFAULT_CONFIG.message.allowAllGroups,
    "message.allowAllGroups",
  );
  const groupWhitelist = identifierArray(
    message.groupWhitelist,
    "message.groupWhitelist",
  );
  if (
    enabled &&
    handleGroup &&
    !allowAllGroups &&
    groupWhitelist.length === 0
  ) {
    throw new Error(
      "wechat-ipad: group messages require a non-empty groupWhitelist or allowAllGroups=true",
    );
  }

  const configuredToken = tokenValue(auth.token, "auth.token");
  const envToken = tokenValue(
    env.WECHAT_IPAD_BRIDGE_TOKEN,
    "WECHAT_IPAD_BRIDGE_TOKEN",
  );
  const token = configuredToken || envToken || undefined;
  const serviceUrl = validateEndpoint(
    raw.serviceUrl,
    DEFAULT_CONFIG.serviceUrl,
    "websocket",
  );
  const apiUrl = validateEndpoint(raw.apiUrl, DEFAULT_CONFIG.apiUrl, "http");
  const allowSplitBridgeHosts = booleanValue(
    raw.allowSplitBridgeHosts,
    DEFAULT_CONFIG.allowSplitBridgeHosts,
    "allowSplitBridgeHosts",
  );
  if (
    enabled &&
    (endpointIsRemote(serviceUrl) || endpointIsRemote(apiUrl)) &&
    !token
  ) {
    throw new Error("wechat-ipad: remote bridge endpoints require auth.token");
  }
  if (
    enabled &&
    endpointHostKey(serviceUrl) !== endpointHostKey(apiUrl) &&
    !allowSplitBridgeHosts
  ) {
    throw new Error(
      "wechat-ipad: WebSocket and HTTP bridge hosts differ; set allowSplitBridgeHosts=true only after reviewing Token exposure",
    );
  }

  return {
    enabled,
    acknowledgeUnofficialProtocolRisk,
    required: booleanValue(raw.required, DEFAULT_CONFIG.required, "required"),
    allowSplitBridgeHosts,
    serviceUrl,
    apiUrl,
    reconnect: {
      enabled: booleanValue(
        reconnect.enabled,
        DEFAULT_CONFIG.reconnect.enabled,
        "reconnect.enabled",
      ),
      initialDelayMs: boundedInteger(
        reconnect.initialDelayMs,
        DEFAULT_CONFIG.reconnect.initialDelayMs,
        100,
        60_000,
        "reconnect.initialDelayMs",
      ),
      maxDelayMs: boundedInteger(
        reconnect.maxDelayMs,
        DEFAULT_CONFIG.reconnect.maxDelayMs,
        1000,
        300_000,
        "reconnect.maxDelayMs",
      ),
      maxRetries: boundedInteger(
        reconnect.maxRetries,
        DEFAULT_CONFIG.reconnect.maxRetries,
        0,
        10_000,
        "reconnect.maxRetries",
      ),
      jitterRatio: boundedNumber(
        reconnect.jitterRatio,
        DEFAULT_CONFIG.reconnect.jitterRatio,
        0,
        1,
        "reconnect.jitterRatio",
      ),
    },
    auth: { token },
    network: {
      connectTimeoutMs: boundedInteger(
        network.connectTimeoutMs,
        DEFAULT_CONFIG.network.connectTimeoutMs,
        100,
        120_000,
        "network.connectTimeoutMs",
      ),
      requestTimeoutMs: boundedInteger(
        network.requestTimeoutMs,
        DEFAULT_CONFIG.network.requestTimeoutMs,
        100,
        120_000,
        "network.requestTimeoutMs",
      ),
      maxResponseBytes: boundedInteger(
        network.maxResponseBytes,
        DEFAULT_CONFIG.network.maxResponseBytes,
        1024,
        10 * 1024 * 1024,
        "network.maxResponseBytes",
      ),
      maxEventBytes: boundedInteger(
        network.maxEventBytes,
        DEFAULT_CONFIG.network.maxEventBytes,
        1024,
        10 * 1024 * 1024,
        "network.maxEventBytes",
      ),
      heartbeatIntervalMs: boundedInteger(
        network.heartbeatIntervalMs,
        DEFAULT_CONFIG.network.heartbeatIntervalMs,
        1000,
        300_000,
        "network.heartbeatIntervalMs",
      ),
      pongTimeoutMs: boundedInteger(
        network.pongTimeoutMs,
        DEFAULT_CONFIG.network.pongTimeoutMs,
        500,
        120_000,
        "network.pongTimeoutMs",
      ),
      stableConnectionMs: boundedInteger(
        network.stableConnectionMs,
        DEFAULT_CONFIG.network.stableConnectionMs,
        1000,
        600_000,
        "network.stableConnectionMs",
      ),
    },
    message: {
      dmPolicy,
      allowFrom,
      commandAllowFrom,
      handleGroup,
      groupWhitelist,
      allowAllGroups,
      ignoreSelf: booleanValue(
        message.ignoreSelf,
        DEFAULT_CONFIG.message.ignoreSelf,
        "message.ignoreSelf",
      ),
      maxTextChars: boundedInteger(
        message.maxTextChars,
        DEFAULT_CONFIG.message.maxTextChars,
        1,
        100_000,
        "message.maxTextChars",
      ),
      maxPendingMessages: boundedInteger(
        message.maxPendingMessages,
        DEFAULT_CONFIG.message.maxPendingMessages,
        1,
        10_000,
        "message.maxPendingMessages",
      ),
    },
  };
}
