/**
 * @fileoverview WebSocket 渠道账号与 `channels.web-socket` 配置解析。
 *
 * @module web-socket/config
 */

import type { ChannelAccountSnapshot, OpenClawConfig } from "openclaw/plugin-sdk";

import type {
  OpenClawDmScope,
  WebsocketAgentBinding,
  WebsocketChannelConfig,
  WebsocketMode,
} from "./types.js";

export type { WebsocketChannelConfig } from "./types.js";

export const DEFAULT_WEBSOCKET_ACCOUNT_ID = "default";

export type ResolvedWebsocketAccount = {
  accountId: string;
  name: string;
  enabled: boolean;
  configured: boolean;
};

const DEFAULT_SERVER = {
  wsPort: 18789,
  path: "/openclaw/ws",
  host: "127.0.0.1",
  maxConnections: 1000,
  auth: {
    enabled: false,
    tokens: [] as string[],
    allowQueryToken: false,
    allowProtocolToken: true,
  },
  allowedOrigins: [] as string[],
  tls: {
    enabled: false,
    minVersion: "TLSv1.2" as const,
    requestCert: false,
    rejectUnauthorized: true,
  },
  allowInsecureRemote: false,
};

const DEFAULT_CLIENT = {
  protocols: [] as string[],
  headers: {} as Record<string, string>,
  clientId: "openclaw-client",
  connectTimeoutMs: 10_000,
  allowInsecureRemote: false,
  reconnect: {
    enabled: true,
    initialDelayMs: 1_000,
    maxDelayMs: 30_000,
    jitterRatio: 0.2,
  },
};

export const DEFAULT_WEBSOCKET_CONFIG: WebsocketChannelConfig = {
  mode: "server",
  server: { ...DEFAULT_SERVER },
  client: { ...DEFAULT_CLIENT },
  agentBindings: [],
  allowFrameAgentId: false,
  payload: {
    mode: "jsonTextOrPlain",
    outboundFormat: "envelope",
  },
  limits: {
    maxPayloadBytes: 1024 * 1024,
    maxBufferedBytes: 1024 * 1024,
    maxPendingMessages: 32,
    messagesPerMinute: 120,
    heartbeatIntervalMs: 30_000,
    heartbeatTimeoutMs: 10_000,
  },
  session: {
    maxExpirySeconds: 86400,
    persistentAcrossReconnect: true,
  },
};

/**
 * 列出账号 id（单账号阶段仅 default）。
 */
export function listWebsocketAccountIds(_cfg: OpenClawConfig): string[] {
  return [DEFAULT_WEBSOCKET_ACCOUNT_ID];
}

/**
 * 解析默认账号 id。
 */
export function resolveDefaultWebsocketAccountId(_cfg: OpenClawConfig): string {
  return DEFAULT_WEBSOCKET_ACCOUNT_ID;
}

/**
 * 判断渠道是否已配置（按 mode 校验必填项）。
 */
export function isWebsocketChannelConfigured(section: Record<string, unknown>): boolean {
  const mode = parseMode(section.mode);
  const url =
    (typeof section.url === "string" ? section.url.trim() : "") ||
    (typeof asRecord(section.client).url === "string"
      ? String(asRecord(section.client).url).trim()
      : "");
  if (mode === "client") {
    return Boolean(url);
  }
  if (mode === "both") {
    return Boolean(url);
  }
  return true;
}

/**
 * 解析指定账号视图。
 */
export function resolveWebsocketAccount(
  cfg: OpenClawConfig,
  accountId?: string | null,
): ResolvedWebsocketAccount {
  const id = accountId?.trim() || DEFAULT_WEBSOCKET_ACCOUNT_ID;
  const channels = cfg.channels as Record<string, unknown> | undefined;
  const section = channels?.["web-socket"];
  const configured =
    section && typeof section === "object"
      ? isWebsocketChannelConfigured(section as Record<string, unknown>)
      : false;
  return {
    accountId: id,
    name: "WebSocket",
    enabled: true,
    configured,
  };
}

/**
 * 构建账号状态快照描述。
 */
export function describeWebsocketAccountSnapshot(
  account: ResolvedWebsocketAccount,
  wsPort: number,
): ChannelAccountSnapshot {
  return {
    accountId: account.accountId,
    name: account.name,
    enabled: account.enabled,
    configured: account.configured,
    port: wsPort,
    running: false,
    webhookPath: "/web-socket/status",
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseMode(raw: unknown): WebsocketMode {
  const value = String(raw ?? "server");
  if (value === "client" || value === "both") {
    return value;
  }
  return "server";
}

function parseAgentBindings(raw: unknown): WebsocketAgentBinding[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: WebsocketAgentBinding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const agentId = String(row.agentId ?? "").trim();
    if (!agentId) continue;
    out.push({
      agentId,
      accountId: typeof row.accountId === "string" ? row.accountId.trim() : undefined,
      connectionId:
        typeof row.connectionId === "string" ? row.connectionId.trim() : undefined,
      connectionIdPrefix:
        typeof row.connectionIdPrefix === "string"
          ? row.connectionIdPrefix.trim()
          : undefined,
    });
  }
  return out;
}

function parseServerAuth(auth: Record<string, unknown>) {
  const tokens: string[] = [];
  if (typeof auth.token === "string" && auth.token.trim()) {
    tokens.push(auth.token.trim());
  }
  if (Array.isArray(auth.tokens)) {
    for (const t of auth.tokens) {
      if (typeof t === "string" && t.trim()) {
        tokens.push(t.trim());
      }
    }
  }
  return {
    enabled: Boolean(auth.enabled),
    token: typeof auth.token === "string" ? auth.token : undefined,
    tokens,
    allowQueryToken: auth.allowQueryToken === true,
    allowProtocolToken: auth.allowProtocolToken !== false,
  };
}

/**
 * 只在字段缺失时使用默认值；显式提供的非法值必须保留下来交给 validate 报错。
 * 不能静默截断生产配置，否则运维人员看到的配置与真实运行参数会不一致。
 */
function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function ratioOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
    : [];
}

/**
 * 从 OpenClaw 全局配置解析 `channels.web-socket`。
 *
 * 支持扁平字段（向后兼容）与 `server` / `client` 嵌套块。
 */
export function resolveWebsocketConfig(
  globalConfig: Record<string, unknown>,
): WebsocketChannelConfig {
  const channels = asRecord(globalConfig.channels);
  const section = asRecord(channels["web-socket"]);
  const mode = parseMode(section.mode);

  const serverSection = asRecord(section.server);
  const clientSection = asRecord(section.client);
  const auth = asRecord(
    section.auth !== undefined && typeof section.auth === "object"
      ? section.auth
      : serverSection.auth,
  );
  const payload = asRecord(section.payload);
  const limits = asRecord(section.limits);
  const session = asRecord(section.session);
  const clientReconnect = asRecord(clientSection.reconnect);
  const tls = asRecord(serverSection.tls ?? section.tls);

  const url =
    (typeof section.url === "string" ? section.url.trim() : "") ||
    (typeof clientSection.url === "string" ? clientSection.url.trim() : "") ||
    undefined;

  const clientHeaders: Record<string, string> = {};
  const rawHeaders = clientSection.headers ?? section.clientHeaders;
  if (rawHeaders && typeof rawHeaders === "object" && !Array.isArray(rawHeaders)) {
    for (const [key, value] of Object.entries(rawHeaders as Record<string, unknown>)) {
      if (typeof value === "string") {
        clientHeaders[key] = value;
      }
    }
  }

  const clientToken =
    (typeof clientSection.token === "string" ? clientSection.token : undefined) ??
    (typeof section.clientToken === "string" ? section.clientToken : undefined);

  const defaultAgentId =
    typeof section.defaultAgentId === "string" && section.defaultAgentId.trim()
      ? section.defaultAgentId.trim()
      : undefined;

  const wsPort =
    typeof serverSection.wsPort === "number"
      ? serverSection.wsPort
      : typeof section.wsPort === "number"
        ? section.wsPort
        : DEFAULT_SERVER.wsPort;

  const pathRaw =
    (typeof serverSection.path === "string" ? serverSection.path : undefined) ??
    (typeof section.path === "string" ? section.path : undefined) ??
    DEFAULT_SERVER.path;

  return {
    mode,
    server: {
      wsPort: numberOrDefault(wsPort, DEFAULT_SERVER.wsPort),
      path: pathRaw.startsWith("/") ? pathRaw.trim() : `/${pathRaw.trim()}`,
      host:
        (typeof serverSection.host === "string" ? serverSection.host.trim() : "") ||
        (typeof section.host === "string" ? section.host.trim() : "") ||
        DEFAULT_SERVER.host,
      maxConnections: numberOrDefault(
        typeof serverSection.maxConnections === "number"
          ? serverSection.maxConnections
          : typeof section.maxConnections === "number"
            ? section.maxConnections
            : DEFAULT_SERVER.maxConnections,
        DEFAULT_SERVER.maxConnections,
      ),
      auth: parseServerAuth(auth),
      allowedOrigins: stringList(serverSection.allowedOrigins ?? section.allowedOrigins),
      tls: {
        enabled: tls.enabled === true,
        keyFile: typeof tls.keyFile === "string" ? tls.keyFile.trim() || undefined : undefined,
        certFile: typeof tls.certFile === "string" ? tls.certFile.trim() || undefined : undefined,
        caFile: typeof tls.caFile === "string" ? tls.caFile.trim() || undefined : undefined,
        minVersion: tls.minVersion === "TLSv1.3" ? "TLSv1.3" : "TLSv1.2",
        requestCert: tls.requestCert === true,
        rejectUnauthorized: tls.rejectUnauthorized !== false,
      },
      allowInsecureRemote:
        serverSection.allowInsecureRemote === true || section.allowInsecureRemote === true,
    },
    client: {
      url,
      protocols: Array.isArray(clientSection.protocols)
        ? clientSection.protocols.filter((p): p is string => typeof p === "string")
        : DEFAULT_CLIENT.protocols,
      headers: clientHeaders,
      token: clientToken,
      clientId:
        (typeof clientSection.clientId === "string" ? clientSection.clientId.trim() : "") ||
        (typeof section.clientId === "string" ? section.clientId.trim() : "") ||
        DEFAULT_CLIENT.clientId,
      connectTimeoutMs: numberOrDefault(
        clientSection.connectTimeoutMs,
        DEFAULT_CLIENT.connectTimeoutMs,
      ),
      allowInsecureRemote: clientSection.allowInsecureRemote === true,
      reconnect: {
        enabled:
          typeof clientReconnect.enabled === "boolean"
            ? clientReconnect.enabled
            : section.clientReconnect !== false,
        initialDelayMs: numberOrDefault(clientReconnect.initialDelayMs, 1_000),
        maxDelayMs: numberOrDefault(clientReconnect.maxDelayMs, 30_000),
        jitterRatio: ratioOrDefault(clientReconnect.jitterRatio, 0.2),
      },
    },
    defaultAgentId,
    allowFrameAgentId: section.allowFrameAgentId === true,
    agentBindings: parseAgentBindings(section.agentBindings),
    payload: {
      mode: "jsonTextOrPlain",
      outboundFormat:
        payload.outboundFormat === "plain" ? "plain" : "envelope",
    },
    limits: {
      maxPayloadBytes: numberOrDefault(limits.maxPayloadBytes, DEFAULT_WEBSOCKET_CONFIG.limits.maxPayloadBytes),
      maxBufferedBytes: numberOrDefault(limits.maxBufferedBytes, DEFAULT_WEBSOCKET_CONFIG.limits.maxBufferedBytes),
      maxPendingMessages: numberOrDefault(limits.maxPendingMessages, DEFAULT_WEBSOCKET_CONFIG.limits.maxPendingMessages),
      messagesPerMinute: numberOrDefault(limits.messagesPerMinute, DEFAULT_WEBSOCKET_CONFIG.limits.messagesPerMinute),
      heartbeatIntervalMs: numberOrDefault(limits.heartbeatIntervalMs, DEFAULT_WEBSOCKET_CONFIG.limits.heartbeatIntervalMs),
      heartbeatTimeoutMs: numberOrDefault(limits.heartbeatTimeoutMs, DEFAULT_WEBSOCKET_CONFIG.limits.heartbeatTimeoutMs),
    },
    session: {
      maxExpirySeconds: numberOrDefault(
        session.maxExpirySeconds,
        DEFAULT_WEBSOCKET_CONFIG.session.maxExpirySeconds,
      ),
      persistentAcrossReconnect:
        typeof session.persistentAcrossReconnect === "boolean"
          ? session.persistentAcrossReconnect
          : DEFAULT_WEBSOCKET_CONFIG.session.persistentAcrossReconnect,
    },
  };
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host.toLowerCase() === "localhost";
}

function requireInteger(name: string, value: number, minimum: number, maximum: number): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
}

function validateAllowedOrigins(origins: string[]): void {
  for (const origin of origins) {
    if (origin === "*") {
      throw new Error("server.allowedOrigins must not contain '*'; configure exact origins");
    }
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`invalid server.allowedOrigins entry: ${origin}`);
    }
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.origin !== origin) {
      throw new Error(`server.allowedOrigins must contain exact http(s) origins: ${origin}`);
    }
  }
}

/** 启动前拒绝容易意外暴露凭据或匿名端口的配置。 */
export function validateWebsocketConfig(config: WebsocketChannelConfig): void {
  requireInteger("server.wsPort", config.server.wsPort, 1, 65_535);
  requireInteger("server.maxConnections", config.server.maxConnections, 1, 100_000);
  requireInteger("client.connectTimeoutMs", config.client.connectTimeoutMs, 1, 120_000);
  requireInteger("client.reconnect.initialDelayMs", config.client.reconnect.initialDelayMs, 1, 300_000);
  requireInteger("client.reconnect.maxDelayMs", config.client.reconnect.maxDelayMs, 1, 3_600_000);
  requireInteger("limits.maxPayloadBytes", config.limits.maxPayloadBytes, 1, 16 * 1024 * 1024);
  requireInteger("limits.maxBufferedBytes", config.limits.maxBufferedBytes, 1, 64 * 1024 * 1024);
  requireInteger("limits.maxPendingMessages", config.limits.maxPendingMessages, 1, 10_000);
  requireInteger("limits.messagesPerMinute", config.limits.messagesPerMinute, 1, 1_000_000);
  requireInteger("limits.heartbeatIntervalMs", config.limits.heartbeatIntervalMs, 100, 300_000);
  requireInteger("limits.heartbeatTimeoutMs", config.limits.heartbeatTimeoutMs, 100, 300_000);
  requireInteger("session.maxExpirySeconds", config.session.maxExpirySeconds, 0, 30 * 24 * 60 * 60);
  if (config.client.reconnect.initialDelayMs > config.client.reconnect.maxDelayMs) {
    throw new Error("client.reconnect.initialDelayMs must not exceed maxDelayMs");
  }
  if (!Number.isFinite(config.client.reconnect.jitterRatio) || config.client.reconnect.jitterRatio < 0 || config.client.reconnect.jitterRatio > 1) {
    throw new Error("client.reconnect.jitterRatio must be between 0 and 1");
  }
  if (!config.server.path.startsWith("/") || config.server.path.includes("?") || config.server.path.includes("#")) {
    throw new Error("server.path must be an absolute URL path without query or fragment");
  }
  validateAllowedOrigins(config.server.allowedOrigins);

  if (isServerModeEnabled(config)) {
    if (config.server.auth.enabled && config.server.auth.tokens.length === 0) {
      throw new Error("server.auth.enabled requires at least one non-empty token");
    }
    if (config.server.tls.enabled && (!config.server.tls.keyFile || !config.server.tls.certFile)) {
      throw new Error("server.tls.enabled requires keyFile and certFile");
    }
  }
  if (isServerModeEnabled(config) && !isLoopbackHost(config.server.host)) {
    if (!config.server.auth.enabled) {
      throw new Error("remote WebSocket listener requires server.auth.enabled and at least one token");
    }
    if (!config.server.tls.enabled && !config.server.allowInsecureRemote) {
      throw new Error("remote plaintext listener requires server.allowInsecureRemote=true; prefer a TLS reverse proxy to loopback");
    }
  }
  if (isClientModeEnabled(config) && config.client.url) {
    const url = new URL(config.client.url);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") {
      throw new Error("client.url must use ws:// or wss://");
    }
    if (url.protocol === "ws:" && !isLoopbackHost(url.hostname) && !config.client.allowInsecureRemote) {
      throw new Error("remote plaintext client URL requires client.allowInsecureRemote=true; use wss:// in production");
    }
  }
}

/**
 * 是否启用内置服务端。
 */
export function isServerModeEnabled(config: WebsocketChannelConfig): boolean {
  return config.mode === "server" || config.mode === "both";
}

/**
 * 是否启用外部 WS 客户端。
 */
export function isClientModeEnabled(config: WebsocketChannelConfig): boolean {
  return config.mode === "client" || config.mode === "both";
}

/**
 * 读取全局 session.dmScope。
 */
export function resolveOpenClawDmScope(
  globalConfig: Record<string, unknown>,
): OpenClawDmScope {
  const session = asRecord(globalConfig.session);
  const raw = String(session.dmScope ?? "per-peer");
  if (
    raw === "main" ||
    raw === "per-peer" ||
    raw === "per-channel-peer" ||
    raw === "per-account-channel-peer"
  ) {
    return raw;
  }
  return "per-peer";
}
