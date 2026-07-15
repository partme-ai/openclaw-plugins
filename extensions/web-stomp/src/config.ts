/** channels.stomp configuration parsing and fail-closed validation. */
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

function positiveInt(value: unknown, fallback: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? Math.min(value, max)
    : fallback;
}

function nonNegativeInt(value: unknown, fallback: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? Math.min(value, max)
    : fallback;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
    : [];
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
    wsPort: positiveInt(raw.wsPort ?? raw.port, DEFAULT_STOMP_WS_CONFIG.wsPort, 65_535),
    path: (() => {
      const path = typeof raw.path === "string" ? raw.path.trim() : DEFAULT_STOMP_WS_CONFIG.path;
      return path.startsWith("/") ? path : `/${path}`;
    })(),
    host: typeof raw.host === "string" && raw.host.trim() ? raw.host.trim() : DEFAULT_STOMP_WS_CONFIG.host,
    heartbeatIncoming: nonNegativeInt(
      raw.heartbeatIncoming ?? heartbeat.clientMs,
      DEFAULT_STOMP_WS_CONFIG.heartbeatIncoming,
      300_000,
    ),
    heartbeatOutgoing: nonNegativeInt(
      raw.heartbeatOutgoing ?? heartbeat.serverMs,
      DEFAULT_STOMP_WS_CONFIG.heartbeatOutgoing,
      300_000,
    ),
    maxConnections: positiveInt(raw.maxConnections ?? limits.maxConnections, DEFAULT_STOMP_WS_CONFIG.maxConnections, 100_000),
    maxFrameSize: positiveInt(raw.maxFrameSize ?? limits.maxFrameSize, DEFAULT_STOMP_WS_CONFIG.maxFrameSize, 16 * 1024 * 1024),
    maxBufferedBytes: positiveInt(limits.maxBufferedBytes, DEFAULT_STOMP_WS_CONFIG.maxBufferedBytes, 64 * 1024 * 1024),
    maxSubscriptionsPerConnection: positiveInt(limits.maxSubscriptionsPerConnection, DEFAULT_STOMP_WS_CONFIG.maxSubscriptionsPerConnection, 10_000),
    maxPendingMessages: positiveInt(limits.maxPendingMessages, DEFAULT_STOMP_WS_CONFIG.maxPendingMessages, 10_000),
    maxPendingAcks: positiveInt(limits.maxPendingAcks ?? raw.prefetchCount, DEFAULT_STOMP_WS_CONFIG.maxPendingAcks, 100_000),
    messagesPerMinute: positiveInt(limits.messagesPerMinute, DEFAULT_STOMP_WS_CONFIG.messagesPerMinute, 1_000_000),
    connectTimeoutMs: positiveInt(limits.connectTimeoutMs, DEFAULT_STOMP_WS_CONFIG.connectTimeoutMs, 120_000),
    allowedOrigins: strings(ws.allowedOrigins ?? raw.allowedOrigins),
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
    const password = user.passwordEnv ? process.env[user.passwordEnv] : user.password;
    if (!password && !user.passwordHash) issues.push(`auth user ${user.login} has no password, passwordEnv value, or passwordHash`);
  }
  return issues;
}

export function assertValidStompWsConfig(config: StompServerConfig): void {
  const issues = validateStompWsConfig(config);
  if (issues.length > 0) throw new Error(`Invalid channels.stomp config: ${issues.join("; ")}`);
}

export function buildStompConfigSnapshot(config: StompServerConfig): Record<string, unknown> {
  return {
    ...config,
    auth: {
      required: config.auth.required,
      users: config.auth.users.map((user) => ({
        login: user.login,
        credentialConfigured: Boolean(user.password || user.passwordEnv || user.passwordHash),
        passwordEnv: user.passwordEnv ?? null,
        hashAlgorithm: user.hashAlgorithm ?? "sha256",
      })),
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
