/**
 * @fileoverview `channels.stomp` 的 Web STOMP 配置解析与封闭式生产校验。
 *
 * 配置覆盖 WS/WSS 监听、Origin、登录用户、心跳、连接/帧/ACK 上限和 Agent 白名单。非回环
 * 监听必须启用 TLS，公开 TLS 监听还必须具备登录认证或受信客户端证书；状态快照不会输出
 * 明文密码或散列内容。
 */
import type { ChannelAccountSnapshot, OpenClawConfig } from "openclaw/plugin-sdk";

import type { ResolvedWebStompAccount, StompAuthUser, StompServerConfig } from "./types.js";

export const WEB_STOMP_ACCOUNT_ID = "default";

export const DEFAULT_STOMP_WS_CONFIG: StompServerConfig = {
  wsPort: 15674,
  path: "/ws",
  host: "127.0.0.1",
  heartbeatIncoming: 10_000,
  heartbeatOutgoing: 10_000,
  maxConnections: 500,
  maxFrameSize: 256 * 1024,
  maxBufferedBytes: 1024 * 1024,
  maxSubscriptionsPerConnection: 100,
  maxPendingMessages: 32,
  maxPendingAcks: 100,
  messagesPerMinute: 120,
  connectTimeoutMs: 10_000,
  shutdownTimeoutMs: 10_000,
  allowedOrigins: [],
  allowSharedTopics: false,
  defaultAgentId: "main",
  allowedAgentIds: [],
  auth: { required: true, users: [] },
  tls: {
    enabled: false,
    minVersion: "TLSv1.2",
    requestCert: false,
    rejectUnauthorized: false,
  },
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** 保留用户显式配置的有限数字，让启动校验能暴露 0、负数、小数和超上限误配。 */
function configuredNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
    : [];
}

/** 合法 Origin 统一为 URL.origin；非法值保留，交由 validate 输出可定位错误。 */
function origins(value: unknown): string[] {
  return [...new Set(strings(value).map((origin) => {
    try {
      const url = new URL(origin);
      if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== "/")) return origin;
      return url.origin;
    } catch {
      return origin;
    }
  }))];
}

function authUsers(value: unknown): StompAuthUser[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): StompAuthUser[] => {
    const row = record(item);
    const login = typeof row.login === "string" ? row.login.trim() : "";
    if (!login) return [];
    return [{
      login,
      password: typeof row.password === "string" ? row.password : undefined,
      passwordEnv: typeof row.passwordEnv === "string" ? row.passwordEnv.trim() || undefined : undefined,
      passwordHash: typeof row.passwordHash === "string" ? row.passwordHash.trim() || undefined : undefined,
      hashAlgorithm: row.hashAlgorithm === "sha512" ? "sha512" : "sha256",
    }];
  });
}

export function resolveStompWsConfig(globalConfig: Record<string, unknown>): StompServerConfig {
  const channels = record(globalConfig.channels);
  const raw = record(channels.stomp);
  const heartbeat = record(raw.heartbeat);
  const limits = record(raw.limits);
  const auth = record(raw.auth);
  const tls = record(raw.tls);
  const ws = record(raw.ws);
  return {
    wsPort: configuredNumber(raw.wsPort ?? raw.port, DEFAULT_STOMP_WS_CONFIG.wsPort),
    path: (() => {
      const path = typeof raw.path === "string" ? raw.path.trim() : DEFAULT_STOMP_WS_CONFIG.path;
      return path.startsWith("/") ? path : `/${path}`;
    })(),
    host: typeof raw.host === "string" && raw.host.trim() ? raw.host.trim() : DEFAULT_STOMP_WS_CONFIG.host,
    heartbeatIncoming: configuredNumber(
      raw.heartbeatIncoming ?? heartbeat.clientMs,
      DEFAULT_STOMP_WS_CONFIG.heartbeatIncoming,
    ),
    heartbeatOutgoing: configuredNumber(
      raw.heartbeatOutgoing ?? heartbeat.serverMs,
      DEFAULT_STOMP_WS_CONFIG.heartbeatOutgoing,
    ),
    maxConnections: configuredNumber(raw.maxConnections ?? limits.maxConnections, DEFAULT_STOMP_WS_CONFIG.maxConnections),
    maxFrameSize: configuredNumber(raw.maxFrameSize ?? limits.maxFrameSize, DEFAULT_STOMP_WS_CONFIG.maxFrameSize),
    maxBufferedBytes: configuredNumber(limits.maxBufferedBytes, DEFAULT_STOMP_WS_CONFIG.maxBufferedBytes),
    maxSubscriptionsPerConnection: configuredNumber(limits.maxSubscriptionsPerConnection, DEFAULT_STOMP_WS_CONFIG.maxSubscriptionsPerConnection),
    maxPendingMessages: configuredNumber(limits.maxPendingMessages, DEFAULT_STOMP_WS_CONFIG.maxPendingMessages),
    maxPendingAcks: configuredNumber(limits.maxPendingAcks ?? raw.prefetchCount, DEFAULT_STOMP_WS_CONFIG.maxPendingAcks),
    messagesPerMinute: configuredNumber(limits.messagesPerMinute, DEFAULT_STOMP_WS_CONFIG.messagesPerMinute),
    connectTimeoutMs: configuredNumber(limits.connectTimeoutMs, DEFAULT_STOMP_WS_CONFIG.connectTimeoutMs),
    shutdownTimeoutMs: configuredNumber(limits.shutdownTimeoutMs, DEFAULT_STOMP_WS_CONFIG.shutdownTimeoutMs),
    allowedOrigins: origins(ws.allowedOrigins ?? raw.allowedOrigins),
    allowSharedTopics: raw.allowSharedTopics === true,
    defaultAgentId: typeof raw.defaultAgentId === "string" && raw.defaultAgentId.trim()
      ? raw.defaultAgentId.trim()
      : DEFAULT_STOMP_WS_CONFIG.defaultAgentId,
    allowedAgentIds: strings(raw.allowedAgentIds),
    auth: {
      required: auth.required !== false,
      users: authUsers(auth.users),
    },
    tls: {
      enabled: tls.enabled === true,
      keyFile: typeof tls.keyFile === "string" ? tls.keyFile.trim() || undefined : undefined,
      certFile: typeof tls.certFile === "string" ? tls.certFile.trim() || undefined : undefined,
      caFile: typeof tls.caFile === "string" ? tls.caFile.trim() || undefined : undefined,
      minVersion: tls.minVersion === "TLSv1.3" ? "TLSv1.3" : "TLSv1.2",
      requestCert: tls.requestCert === true,
      rejectUnauthorized: tls.rejectUnauthorized === true,
    },
  };
}

function isLoopback(host: string): boolean {
  const value = host.trim().toLowerCase();
  return value === "localhost" || value === "::1" || value.startsWith("127.");
}

export function validateStompWsConfig(config: StompServerConfig): string[] {
  const issues: string[] = [];
  const integerRanges: Array<[keyof StompServerConfig, number, number]> = [
    ["wsPort", 1, 65_535],
    ["heartbeatIncoming", 0, 300_000],
    ["heartbeatOutgoing", 0, 300_000],
    ["maxConnections", 1, 100_000],
    ["maxFrameSize", 1, 16 * 1024 * 1024],
    ["maxBufferedBytes", 1, 64 * 1024 * 1024],
    ["maxSubscriptionsPerConnection", 1, 10_000],
    ["maxPendingMessages", 1, 10_000],
    ["maxPendingAcks", 1, 100_000],
    ["messagesPerMinute", 1, 1_000_000],
    ["connectTimeoutMs", 1, 120_000],
    ["shutdownTimeoutMs", 100, 120_000],
  ];
  for (const [key, min, max] of integerRanges) {
    const value = config[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
      issues.push(`${String(key)} must be an integer between ${min} and ${max}`);
    }
  }
  if (!/^\/[^?#]*$/.test(config.path)) issues.push("path must be an absolute WebSocket path without query or fragment");
  const validAgentId = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
  if (!validAgentId(config.defaultAgentId)) issues.push("defaultAgentId is invalid");
  if (config.allowedAgentIds.some((agentId) => !validAgentId(agentId))) issues.push("allowedAgentIds contains an invalid Agent id");
  for (const origin of config.allowedOrigins) {
    try {
      const url = new URL(origin);
      if (!(["http:", "https:"] as string[]).includes(url.protocol) || url.origin !== origin || origin === "*") throw new Error();
    } catch {
      issues.push(`allowedOrigins contains an invalid canonical http/https Origin: ${origin}`);
    }
  }
  if (config.tls.enabled && (!config.tls.keyFile || !config.tls.certFile)) {
    issues.push("tls.enabled=true requires tls.keyFile and tls.certFile");
  }
  if (!config.tls.enabled && !isLoopback(config.host)) {
    issues.push("plaintext Web STOMP may only bind a loopback address");
  }
  if (!isLoopback(config.host) && !config.auth.required) {
    issues.push("a non-loopback Web STOMP listener requires authentication");
  }
  if (config.auth.required && config.auth.users.length === 0) {
    issues.push("auth.required=true requires at least one auth.users entry");
  }
  const logins = new Set<string>();
  for (const user of config.auth.users) {
    if (logins.has(user.login)) issues.push(`duplicate auth user: ${user.login}`);
    logins.add(user.login);
    if (/\p{C}/u.test(user.login)) issues.push(`auth user login contains control characters: ${user.login}`);
    const credentialCount = [user.password, user.passwordEnv, user.passwordHash].filter((value) => value !== undefined).length;
    if (credentialCount !== 1) issues.push(`auth user ${user.login} must configure exactly one credential source`);
    const password = user.passwordEnv ? process.env[user.passwordEnv] : user.password;
    if (user.passwordEnv && !password) issues.push(`auth user ${user.login} has no password in environment variable ${user.passwordEnv}`);
    if (user.passwordHash) {
      const expectedLength = user.hashAlgorithm === "sha512" ? 128 : 64;
      if (!new RegExp(`^[a-fA-F0-9]{${expectedLength}}$`).test(user.passwordHash)) {
        issues.push(`auth user ${user.login} has an invalid ${user.hashAlgorithm ?? "sha256"} passwordHash`);
      }
    }
  }
  return issues;
}

export function assertValidStompWsConfig(config: StompServerConfig): void {
  const issues = validateStompWsConfig(config);
  if (issues.length > 0) throw new Error(`Invalid channels.stomp config: ${issues.join("; ")}`);
}

export function buildStompConfigSnapshot(config: StompServerConfig): Record<string, unknown> {
  return {
    wsPort: config.wsPort,
    path: config.path,
    host: config.host,
    heartbeatIncoming: config.heartbeatIncoming,
    heartbeatOutgoing: config.heartbeatOutgoing,
    maxConnections: config.maxConnections,
    maxFrameSize: config.maxFrameSize,
    maxBufferedBytes: config.maxBufferedBytes,
    maxSubscriptionsPerConnection: config.maxSubscriptionsPerConnection,
    maxPendingMessages: config.maxPendingMessages,
    maxPendingAcks: config.maxPendingAcks,
    messagesPerMinute: config.messagesPerMinute,
    connectTimeoutMs: config.connectTimeoutMs,
    shutdownTimeoutMs: config.shutdownTimeoutMs,
    allowedOrigins: [...config.allowedOrigins],
    allowSharedTopics: config.allowSharedTopics,
    defaultAgentId: config.defaultAgentId,
    allowedAgentIds: [...config.allowedAgentIds],
    auth: {
      required: config.auth.required,
      users: config.auth.users.map((user) => ({
        login: user.login,
        credentialConfigured: Boolean(user.password || user.passwordEnv || user.passwordHash),
        passwordEnv: user.passwordEnv ?? null,
        hashAlgorithm: user.hashAlgorithm ?? "sha256",
      })),
    },
    tls: {
      enabled: config.tls.enabled,
      minVersion: config.tls.minVersion,
      requestCert: config.tls.requestCert,
      rejectUnauthorized: config.tls.rejectUnauthorized,
      keyConfigured: Boolean(config.tls.keyFile),
      certificateConfigured: Boolean(config.tls.certFile),
      caConfigured: Boolean(config.tls.caFile),
    },
  };
}

export function listStompAccountIds(_cfg: OpenClawConfig): string[] {
  return [WEB_STOMP_ACCOUNT_ID];
}

export function resolveStompAccount(cfg: OpenClawConfig): ResolvedWebStompAccount {
  const section = record((cfg.channels as Record<string, unknown> | undefined)?.stomp);
  return {
    accountId: WEB_STOMP_ACCOUNT_ID,
    name: "STOMP over WebSocket",
    enabled: section.enabled !== false,
    configured: Object.keys(section).length > 0,
  };
}

export function describeStompAccount(account: ResolvedWebStompAccount, config: StompServerConfig): ChannelAccountSnapshot {
  return {
    accountId: account.accountId,
    name: account.name,
    enabled: account.enabled,
    configured: account.configured,
    running: false,
    port: config.wsPort,
    webhookPath: "/stomp/status",
  };
}
