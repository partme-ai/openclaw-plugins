/**
 * @fileoverview `channels.stomp-tcp` 配置解析、默认值和生产安全校验。
 *
 * 配置涵盖 TCP/TLS 监听器、登录用户、心跳、订阅/队列/速率上限、ACK 模式与 Topic 路由。
 * 明文监听只能绑定回环地址；非回环 TLS 必须具备登录认证或受信客户端证书；状态快照会移除
 * 明文密码，只展示凭据是否已配置。
 */
import type { ChannelAccountSnapshot, OpenClawConfig } from "openclaw/plugin-sdk";

import type {
  ResolvedStompTcpAccount,
  StompAckMode,
  StompAuthUser,
  StompTcpConfig,
  TopicBinding,
} from "./types.js";

export const STOMP_TCP_ACCOUNT_ID = "default";

export const DEFAULT_STOMP_TCP_CONFIG: StompTcpConfig = {
  host: "127.0.0.1",
  port: 61613,
  tlsPort: 61614,
  tls: {
    enabled: false,
    host: "127.0.0.1",
    minVersion: "TLSv1.2",
    requestCert: false,
    rejectUnauthorized: false,
  },
  heartbeat: { serverMs: 10_000, clientMs: 10_000 },
  maxConnections: 500,
  maxFrameSize: 256 * 1024,
  maxBufferedBytes: 1024 * 1024,
  maxSubscriptionsPerConnection: 100,
  maxQueueDepthPerSubscription: 1_000,
  maxPendingMessages: 32,
  messagesPerMinute: 120,
  connectTimeoutMs: 10_000,
  maxDurableSubscriptions: 1_000,
  auth: { required: true, users: [] },
  subscribeTopics: [],
  topicBindings: [],
  defaultAgentId: "main",
  allowedAgentIds: [],
  allowSharedTopics: false,
  allowDurableSubscriptions: false,
  defaultAckMode: "auto",
  prefetchCount: 100,
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min ? Math.min(value, max) : fallback;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
    : [];
}

function authUsers(value: unknown, legacy: Record<string, unknown>): StompAuthUser[] {
  const users = Array.isArray(value) ? value.flatMap((item): StompAuthUser[] => {
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
  }) : [];
  if (users.length > 0) return users;
  const login = typeof legacy.defaultUser === "string" ? legacy.defaultUser.trim() : "";
  const password = typeof legacy.defaultPass === "string" ? legacy.defaultPass : "";
  return login && password ? [{ login, password }] : [];
}

function topicBindings(value: unknown): TopicBinding[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): TopicBinding[] => {
    const row = record(item);
    const topicPattern = typeof row.topicPattern === "string" ? row.topicPattern.trim() : "";
    const agentId = typeof row.agentId === "string" ? row.agentId.trim() : "";
    if (!topicPattern || !agentId) return [];
    return [{
      topicPattern,
      agentId,
      accountId: typeof row.accountId === "string" ? row.accountId.trim() || undefined : undefined,
      replyTopic: typeof row.replyTopic === "string" ? row.replyTopic.trim() || undefined : undefined,
    }];
  });
}

function ackMode(value: unknown): StompAckMode {
  return value === "client" || value === "client-individual" ? value : "auto";
}

/** 将 OpenClaw 全局配置解析为边界完整的 STOMP Server 配置。 */
export function resolveStompTcpConfig(globalConfig: Record<string, unknown>): StompTcpConfig {
  const raw = record(record(globalConfig.channels)["stomp-tcp"]);
  const tls = record(raw.tls);
  const heartbeat = record(raw.heartbeat);
  const limits = record(raw.limits);
  const auth = record(raw.auth);
  const host = typeof raw.host === "string" && raw.host.trim() ? raw.host.trim() : DEFAULT_STOMP_TCP_CONFIG.host;
  return {
    host,
    port: boundedInt(raw.port, DEFAULT_STOMP_TCP_CONFIG.port, 0, 65_535),
    tlsPort: boundedInt(raw.tlsPort, DEFAULT_STOMP_TCP_CONFIG.tlsPort, 1, 65_535),
    tls: {
      enabled: tls.enabled === true,
      host: typeof tls.host === "string" && tls.host.trim() ? tls.host.trim() : host,
      certFile: typeof tls.certFile === "string" ? tls.certFile.trim() || undefined : undefined,
      keyFile: typeof tls.keyFile === "string" ? tls.keyFile.trim() || undefined : undefined,
      caFile: typeof tls.caFile === "string" ? tls.caFile.trim() || undefined : undefined,
      minVersion: tls.minVersion === "TLSv1.3" ? "TLSv1.3" : "TLSv1.2",
      requestCert: tls.requestCert === true,
      rejectUnauthorized: tls.rejectUnauthorized === true,
    },
    heartbeat: {
      serverMs: boundedInt(heartbeat.serverMs, DEFAULT_STOMP_TCP_CONFIG.heartbeat.serverMs, 0, 300_000),
      clientMs: boundedInt(heartbeat.clientMs, DEFAULT_STOMP_TCP_CONFIG.heartbeat.clientMs, 0, 300_000),
    },
    maxConnections: boundedInt(raw.maxConnections ?? limits.maxConnections, DEFAULT_STOMP_TCP_CONFIG.maxConnections, 1, 100_000),
    maxFrameSize: boundedInt(raw.maxFrameSize ?? limits.maxFrameSize, DEFAULT_STOMP_TCP_CONFIG.maxFrameSize, 1, 16 * 1024 * 1024),
    maxBufferedBytes: boundedInt(limits.maxBufferedBytes, DEFAULT_STOMP_TCP_CONFIG.maxBufferedBytes, 1, 64 * 1024 * 1024),
    maxSubscriptionsPerConnection: boundedInt(limits.maxSubscriptionsPerConnection, DEFAULT_STOMP_TCP_CONFIG.maxSubscriptionsPerConnection, 1, 10_000),
    maxQueueDepthPerSubscription: boundedInt(limits.maxQueueDepthPerSubscription, DEFAULT_STOMP_TCP_CONFIG.maxQueueDepthPerSubscription, 1, 100_000),
    maxPendingMessages: boundedInt(limits.maxPendingMessages, DEFAULT_STOMP_TCP_CONFIG.maxPendingMessages, 1, 10_000),
    messagesPerMinute: boundedInt(limits.messagesPerMinute, DEFAULT_STOMP_TCP_CONFIG.messagesPerMinute, 1, 1_000_000),
    connectTimeoutMs: boundedInt(limits.connectTimeoutMs, DEFAULT_STOMP_TCP_CONFIG.connectTimeoutMs, 1, 120_000),
    maxDurableSubscriptions: boundedInt(limits.maxDurableSubscriptions, DEFAULT_STOMP_TCP_CONFIG.maxDurableSubscriptions, 1, 100_000),
    auth: { required: auth.required !== false, users: authUsers(auth.users, auth) },
    subscribeTopics: strings(raw.subscribeTopics),
    topicBindings: topicBindings(raw.topicBindings),
    defaultAgentId: typeof raw.defaultAgentId === "string" && raw.defaultAgentId.trim() ? raw.defaultAgentId.trim() : DEFAULT_STOMP_TCP_CONFIG.defaultAgentId,
    allowedAgentIds: strings(raw.allowedAgentIds),
    allowSharedTopics: raw.allowSharedTopics === true,
    allowDurableSubscriptions: raw.allowDurableSubscriptions === true,
    defaultAckMode: ackMode(raw.defaultAckMode),
    prefetchCount: boundedInt(raw.prefetchCount, DEFAULT_STOMP_TCP_CONFIG.prefetchCount, 1, 100_000),
  };
}

function isLoopback(host: string): boolean {
  const value = host.trim().toLowerCase();
  return value === "localhost" || value === "::1" || value.startsWith("127.");
}

/** 返回所有生产安全问题，便于 CLI/测试一次展示完整诊断。 */
export function validateStompTcpConfig(config: StompTcpConfig): string[] {
  const issues: string[] = [];
  if (config.port > 0 && !isLoopback(config.host)) issues.push("plaintext STOMP may only bind a loopback address");
  if (config.tls.enabled && (!config.tls.keyFile || !config.tls.certFile)) issues.push("tls.enabled=true requires tls.keyFile and tls.certFile");
  if (
    config.tls.enabled &&
    !isLoopback(config.tls.host) &&
    !config.auth.required &&
    !(config.tls.requestCert && config.tls.rejectUnauthorized)
  ) {
    issues.push("a non-loopback TLS listener requires login authentication or verified client certificates");
  }
  if (config.auth.required && config.auth.users.length === 0) issues.push("auth.required=true requires at least one auth.users entry");
  const logins = new Set<string>();
  for (const user of config.auth.users) {
    if (logins.has(user.login)) issues.push(`duplicate auth user: ${user.login}`);
    logins.add(user.login);
    const password = user.passwordEnv ? process.env[user.passwordEnv] : user.password;
    if (!password && !user.passwordHash) issues.push(`auth user ${user.login} has no password, passwordEnv value, or passwordHash`);
  }
  if (config.tls.rejectUnauthorized && !config.tls.requestCert) issues.push("tls.rejectUnauthorized=true requires tls.requestCert=true");
  if (config.port === 0 && !config.tls.enabled) issues.push("at least one TCP or TLS listener must be enabled");
  return issues;
}

export function assertValidStompTcpConfig(config: StompTcpConfig): void {
  const issues = validateStompTcpConfig(config);
  if (issues.length > 0) throw new Error(`Invalid channels.stomp-tcp config: ${issues.join("; ")}`);
}

export function buildStompTcpConfigSnapshot(config: StompTcpConfig): Record<string, unknown> {
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

export function listStompTcpAccountIds(_cfg: OpenClawConfig): string[] { return [STOMP_TCP_ACCOUNT_ID]; }

export function resolveStompTcpAccount(cfg: OpenClawConfig): ResolvedStompTcpAccount {
  const section = record((cfg.channels as Record<string, unknown> | undefined)?.["stomp-tcp"]);
  return {
    accountId: STOMP_TCP_ACCOUNT_ID,
    name: "STOMP TCP",
    enabled: section.enabled !== false,
    configured: Object.keys(section).length > 0,
  };
}

export function describeStompTcpAccount(account: ResolvedStompTcpAccount, config: StompTcpConfig): ChannelAccountSnapshot {
  return {
    accountId: account.accountId,
    name: account.name,
    enabled: account.enabled,
    configured: account.configured,
    running: false,
    port: config.port || config.tlsPort,
    webhookPath: "/stomp-tcp/status",
  };
}
