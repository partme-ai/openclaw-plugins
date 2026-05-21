import type { GotifyAccountConfig, GotifyChannelConfig, GotifyDmPolicy, ResolvedGotifyAccount } from './types.js';

export const DEFAULT_GOTIFY_ACCOUNT_ID = 'default';
const DEFAULT_PRIORITY = 5;
const DEFAULT_RECONNECT_DELAY_MS = 2_000;
const DEFAULT_MAX_RECONNECT_DELAY_MS = 30_000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;

/**
 * 读取渠道级 Gotify 配置。
 */
export function getGotifyChannelConfig(cfg: Record<string, unknown>): GotifyChannelConfig {
  const channels = (cfg.channels as Record<string, unknown> | undefined) ?? {};
  const gotify = (channels.gotify as GotifyChannelConfig | undefined) ?? {};
  return gotify;
}

/**
 * 枚举全部账号 ID。
 */
export function listGotifyAccountIds(cfg: Record<string, unknown>): string[] {
  const channel = getGotifyChannelConfig(cfg);
  const accountIds = Object.keys(channel.accounts ?? {});
  if (accountIds.length > 0) {
    return accountIds;
  }
  return [DEFAULT_GOTIFY_ACCOUNT_ID];
}

/**
 * 解析默认账号 ID。
 */
export function resolveDefaultGotifyAccountId(cfg: Record<string, unknown>): string {
  const channel = getGotifyChannelConfig(cfg);
  const configured =
    typeof channel.defaultAccount === 'string' && channel.defaultAccount.trim().length > 0
      ? channel.defaultAccount.trim()
      : undefined;
  return configured ?? listGotifyAccountIds(cfg)[0] ?? DEFAULT_GOTIFY_ACCOUNT_ID;
}

/**
 * 解析单个账号配置，并统一补齐默认值。
 */
export function resolveGotifyAccount(
  cfg: Record<string, unknown>,
  accountId?: string | null
): ResolvedGotifyAccount {
  const channel = getGotifyChannelConfig(cfg);
  const resolvedAccountId = accountId?.trim() || resolveDefaultGotifyAccountId(cfg);
  const multiAccount = (channel.accounts?.[resolvedAccountId] ?? {}) as GotifyAccountConfig;
  const singleAccount = resolvedAccountId === DEFAULT_GOTIFY_ACCOUNT_ID ? channel : {};
  const merged = mergeAccount(singleAccount, multiAccount);

  const serverUrl = normalizeString(merged.serverUrl);
  const appToken = normalizeString(merged.appToken);
  const clientToken = normalizeString(merged.clientToken);

  return {
    accountId: resolvedAccountId,
    name: normalizeString(merged.name) ?? resolvedAccountId,
    enabled: merged.enabled ?? true,
    configured: Boolean(serverUrl && appToken),
    serverUrl,
    appToken,
    clientToken,
    defaultPriority: normalizePriority(merged.defaultPriority),
    dmPolicy: normalizeDmPolicy(merged.dmPolicy),
    allowFrom: normalizeAllowFrom(merged.allowFrom),
    inbound: {
      enabled: merged.inbound?.enabled ?? Boolean(clientToken),
      reconnectDelayMs: merged.inbound?.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS,
      maxReconnectDelayMs: merged.inbound?.maxReconnectDelayMs ?? DEFAULT_MAX_RECONNECT_DELAY_MS,
      maxReconnectAttempts: merged.inbound?.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS,
    },
    bootstrap: {
      enabled: merged.bootstrap?.enabled ?? false,
      autoCreateApplication: merged.bootstrap?.autoCreateApplication ?? false,
      applicationName: merged.bootstrap?.applicationName ?? `openclaw-${resolvedAccountId}`,
      applicationDescription:
        merged.bootstrap?.applicationDescription ?? 'Provisioned by openclaw-gotify',
    },
  };
}

/**
 * 对 serverUrl 脱敏，仅保留 scheme + host。
 */
function redactServerUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

/**
 * 生成状态快照中使用的账号摘要。
 */
export function describeGotifyAccountSnapshot(
  account: ResolvedGotifyAccount
): Record<string, unknown> {
  return {
    accountId: account.accountId,
    name: account.name,
    enabled: account.enabled,
    configured: account.configured,
    webhookPath: '/gotify/status',
    serverUrl: redactServerUrl(account.serverUrl),
    inboundEnabled: account.inbound.enabled,
    bootstrapEnabled: account.bootstrap.enabled,
  };
}

function mergeAccount(
  base: GotifyAccountConfig,
  override: GotifyAccountConfig
): GotifyAccountConfig {
  return {
    ...base,
    ...override,
    inbound: {
      ...(base.inbound ?? {}),
      ...(override.inbound ?? {}),
    },
    bootstrap: {
      ...(base.bootstrap ?? {}),
      ...(override.bootstrap ?? {}),
    },
  };
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePriority(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(10, Math.trunc(value)));
  }
  return DEFAULT_PRIORITY;
}

const VALID_DM_POLICIES = new Set<GotifyDmPolicy>(['open', 'allowlist', 'pairing', 'disabled']);

function normalizeDmPolicy(value: unknown): GotifyDmPolicy {
  if (typeof value === 'string' && VALID_DM_POLICIES.has(value as GotifyDmPolicy)) {
    return value as GotifyDmPolicy;
  }
  return 'open';
}

function normalizeAllowFrom(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => String(entry).trim()).filter(Boolean);
}
