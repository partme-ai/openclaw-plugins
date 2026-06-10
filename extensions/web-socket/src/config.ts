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
  host: "0.0.0.0",
  maxConnections: 1000,
  auth: {
    enabled: false,
    tokens: [] as string[],
  },
};

const DEFAULT_CLIENT = {
  protocols: [] as string[],
  headers: {} as Record<string, string>,
  clientId: "openclaw-client",
  reconnect: {
    enabled: true,
    initialDelayMs: 1_000,
    maxDelayMs: 30_000,
  },
};

export const DEFAULT_WEBSOCKET_CONFIG: WebsocketChannelConfig = {
  mode: "server",
  server: { ...DEFAULT_SERVER },
  client: { ...DEFAULT_CLIENT },
  agentBindings: [],
  payload: {
    mode: "jsonTextOrPlain",
    outboundFormat: "envelope",
  },
  limits: {
    maxPayloadBytes: 1024 * 1024,
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
  };
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
      wsPort: wsPort > 0 ? wsPort : DEFAULT_SERVER.wsPort,
      path: pathRaw.startsWith("/") ? pathRaw.trim() : `/${pathRaw.trim()}`,
      host:
        (typeof serverSection.host === "string" ? serverSection.host.trim() : "") ||
        (typeof section.host === "string" ? section.host.trim() : "") ||
        DEFAULT_SERVER.host,
      maxConnections:
        (typeof serverSection.maxConnections === "number"
          ? serverSection.maxConnections
          : typeof section.maxConnections === "number"
            ? section.maxConnections
            : DEFAULT_SERVER.maxConnections) || DEFAULT_SERVER.maxConnections,
      auth: parseServerAuth(auth),
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
      reconnect: {
        enabled:
          typeof clientReconnect.enabled === "boolean"
            ? clientReconnect.enabled
            : section.clientReconnect !== false,
        initialDelayMs:
          typeof clientReconnect.initialDelayMs === "number"
            ? clientReconnect.initialDelayMs
            : 1_000,
        maxDelayMs:
          typeof clientReconnect.maxDelayMs === "number"
            ? clientReconnect.maxDelayMs
            : 30_000,
      },
    },
    defaultAgentId,
    agentBindings: parseAgentBindings(section.agentBindings),
    payload: {
      mode: "jsonTextOrPlain",
      outboundFormat:
        payload.outboundFormat === "plain" ? "plain" : "envelope",
    },
    limits: {
      maxPayloadBytes:
        typeof limits.maxPayloadBytes === "number" && limits.maxPayloadBytes > 0
          ? limits.maxPayloadBytes
          : DEFAULT_WEBSOCKET_CONFIG.limits.maxPayloadBytes,
    },
    session: {
      maxExpirySeconds:
        typeof session.maxExpirySeconds === "number"
          ? session.maxExpirySeconds
          : DEFAULT_WEBSOCKET_CONFIG.session.maxExpirySeconds,
      persistentAcrossReconnect:
        typeof session.persistentAcrossReconnect === "boolean"
          ? session.persistentAcrossReconnect
          : DEFAULT_WEBSOCKET_CONFIG.session.persistentAcrossReconnect,
    },
  };
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
