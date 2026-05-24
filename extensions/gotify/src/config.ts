/**
 * @file Gotify `channels.gotify` 配置解析与账号枚举。
 *
 * @description 统一 **单账号平面 + 多账号 accounts map** 合并策略：账号级覆盖顶层默认，
 * 并对 `inbound` / `bootstrap` 做二级浅+深合并；输出 `ResolvedGotifyAccount` 供 channel / transport 零判空消费。
 * **模块角色**：Channel Plugin · Configuration normalization layer。
 */

import type {
  GotifyAccountConfig,
  GotifyChannelConfig,
  GotifyDmPolicy,
  ResolvedGotifyAccount,
} from "./types.js";
import type { ChannelAccountSnapshot } from "openclaw/plugin-sdk/channel-contract";

/** 单账号模式使用的保留账号 ID。 */
export const DEFAULT_GOTIFY_ACCOUNT_ID = "default";
const DEFAULT_PRIORITY = 5;
const DEFAULT_RECONNECT_DELAY_MS = 2_000;
const DEFAULT_MAX_RECONNECT_DELAY_MS = 30_000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;

/**
 * 从 OpenClaw 总配置中读取 `channels.gotify` 配置节。
 *
 * 该函数只负责结构定位，不做字段校验和默认值补齐；调用方如果需要可用账号，
 * 应继续使用 `resolveGotifyAccount()`，由它统一处理单账号/多账号合并逻辑。
 *
 * @param cfg - OpenClaw 当前完整配置对象，通常来自 gateway runtime 或 setup wizard。
 * @returns 原始 Gotify 渠道配置；未配置时返回空对象，避免调用方反复判空。
 */
export function getGotifyChannelConfig(
  cfg: Record<string, unknown>,
): GotifyChannelConfig {
  const channels = (cfg.channels as Record<string, unknown> | undefined) ?? {};
  const gotify = (channels.gotify as GotifyChannelConfig | undefined) ?? {};
  return gotify;
}

/**
 * 枚举 Gotify 渠道下所有账号 ID。
 *
 * 多账号模式读取 `channels.gotify.accounts` 的键；单账号模式没有显式账号表，
 * 因此返回保留账号 ID `default`，使渠道生命周期、状态快照和出站选择逻辑都能按
 * 同一套 accountId 流程执行。
 *
 * @param cfg - OpenClaw 当前完整配置对象。
 * @returns 账号 ID 列表；至少包含 `default`。
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
 * 解析主动发送或未指定账号时使用的默认 Gotify 账号 ID。
 *
 * 优先级为：
 * 1. `channels.gotify.defaultAccount`
 * 2. 多账号表中的第一个账号
 * 3. 单账号保留值 `default`
 *
 * @param cfg - OpenClaw 当前完整配置对象。
 * @returns 可传给 `resolveGotifyAccount()` 的账号 ID。
 */
export function resolveDefaultGotifyAccountId(
  cfg: Record<string, unknown>,
): string {
  const channel = getGotifyChannelConfig(cfg);
  const configured =
    typeof channel.defaultAccount === "string" &&
    channel.defaultAccount.trim().length > 0
      ? channel.defaultAccount.trim()
      : undefined;
  return (
    configured ?? listGotifyAccountIds(cfg)[0] ?? DEFAULT_GOTIFY_ACCOUNT_ID
  );
}

/**
 * 解析单个 Gotify 账号的最终运行时配置。
 *
 * 单账号模式下读取 `channels.gotify` 顶层字段；多账号模式下读取
 * `channels.gotify.accounts[accountId]`，并让账号级字段覆盖顶层默认字段。
 * 该函数同时会补齐默认 priority、DM 策略、WebSocket 重连参数和 bootstrap 文案。
 *
 * @param cfg - OpenClaw 当前完整配置对象。
 * @param accountId - 目标账号 ID；为空时自动使用默认账号。
 * @returns 已合并、已规范化、可供 channel/runtime 直接使用的账号配置。
 */
export function resolveGotifyAccount(
  cfg: Record<string, unknown>,
  accountId?: string | null,
): ResolvedGotifyAccount {
  const channel = getGotifyChannelConfig(cfg);
  const resolvedAccountId =
    accountId?.trim() || resolveDefaultGotifyAccountId(cfg);
  const multiAccount = (channel.accounts?.[resolvedAccountId] ??
    {}) as GotifyAccountConfig;
  const singleAccount =
    resolvedAccountId === DEFAULT_GOTIFY_ACCOUNT_ID ? channel : {};
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
      allowedAppId: normalizePositiveInt(merged.inbound?.allowedAppId),
      reconnectDelayMs:
        merged.inbound?.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS,
      maxReconnectDelayMs:
        merged.inbound?.maxReconnectDelayMs ?? DEFAULT_MAX_RECONNECT_DELAY_MS,
      maxReconnectAttempts:
        merged.inbound?.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS,
      deleteAfterConsume: merged.inbound?.deleteAfterConsume ?? true,
    },
    bootstrap: {
      enabled: merged.bootstrap?.enabled ?? false,
      autoCreateApplication: merged.bootstrap?.autoCreateApplication ?? false,
      applicationName:
        merged.bootstrap?.applicationName ?? `openclaw-${resolvedAccountId}`,
      applicationDescription:
        merged.bootstrap?.applicationDescription ??
        "Provisioned by openclaw-gotify",
    },
  };
}

/**
 * 对 Gotify serverUrl 做状态输出脱敏。
 *
 * 状态接口只需要展示连接目标的大致位置，因此保留 scheme + host，丢弃 path、
 * query、hash 和 userinfo，避免误把内部路径、临时 token 或反向代理参数暴露给 UI。
 *
 * @param url - 原始 serverUrl；允许为空。
 * @returns 脱敏后的 URL，解析失败或未配置时返回 null。
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
 * 生成可公开展示的 Gotify 账号摘要。
 *
 * 该摘要用于 status endpoint 和渠道列表，不包含 appToken/clientToken 等敏感字段。
 * runtime 的 lastError、lastInboundAt 等运行态字段由 `runtime.ts` 另行合并。
 *
 * @param account - `resolveGotifyAccount()` 解析出的账号配置。
 * @returns 适合返回给 OpenClaw UI/CLI 的账号快照基础字段。
 */
export function describeGotifyAccountSnapshot(
  account: ResolvedGotifyAccount,
): ChannelAccountSnapshot & {
  serverUrl: string | null;
  inboundEnabled: boolean;
  bootstrapEnabled: boolean;
} {
  return {
    accountId: account.accountId,
    name: account.name,
    enabled: account.enabled,
    configured: account.configured,
    webhookPath: "/gotify/status",
    serverUrl: redactServerUrl(account.serverUrl),
    inboundEnabled: account.inbound.enabled,
    bootstrapEnabled: account.bootstrap.enabled,
  };
}

/**
 * 合并顶层默认账号配置与账号级覆盖配置。
 *
 * @param base - 顶层或默认账号配置，作为所有账号的共享默认值。
 * @param override - 指定账号的覆盖配置。
 * @returns 合并后的账号配置对象。
 */
function mergeAccount(
  base: GotifyAccountConfig,
  override: GotifyAccountConfig,
): GotifyAccountConfig {
  /*
   * 顶层对象浅合并，但 inbound/bootstrap 需要二级合并。
   * 这样账号级配置可以只覆盖某一个重连参数，而不必重复声明整个 inbound 对象。
   */
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

/**
 * 将任意配置值规范化为非空字符串。
 *
 * @param value - 待规范化的原始配置值。
 * @returns 去除首尾空白后的字符串；非字符串或空字符串返回 null。
 */
function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 规范化 Gotify 消息优先级。
 *
 * Gotify priority 是整数，本插件将无效值回退为默认值，并把有效数字限制在 0-10，
 * 与配置 schema 和 UI 文案保持一致。
 *
 * @param value - 配置中的 priority 原始值。
 * @returns 0 到 10 之间的整数优先级。
 */
function normalizePriority(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(10, Math.trunc(value)));
  }
  return DEFAULT_PRIORITY;
}

/**
 * 将配置值规范化为正整数 Application ID。
 *
 * @param value - `inbound.allowedAppId` 原始值。
 * @returns 正整数；无效或未配置时返回 0。
 */
function normalizePositiveInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = Math.trunc(value);
    return normalized > 0 ? normalized : 0;
  }
  if (typeof value === "string" && value.trim()) {
    const normalized = Number.parseInt(value.trim(), 10);
    return Number.isFinite(normalized) && normalized > 0 ? normalized : 0;
  }
  return 0;
}

const VALID_DM_POLICIES = new Set<GotifyDmPolicy>([
  "open",
  "allowlist",
  "pairing",
  "disabled",
]);

/**
 * 规范化入站 DM 策略。
 *
 * @param value - 配置中的 `dmPolicy` 原始值。
 * @returns 合法策略值；缺失或非法时返回 `open`，再由 ingress runtime 决定是否需要 wildcard。
 */
function normalizeDmPolicy(value: unknown): GotifyDmPolicy {
  if (
    typeof value === "string" &&
    VALID_DM_POLICIES.has(value as GotifyDmPolicy)
  ) {
    return value as GotifyDmPolicy;
  }
  return "open";
}

/**
 * 规范化 allowlist 条目。
 *
 * @param value - 配置中的 `allowFrom` 原始值。
 * @returns 去除空白和空项后的字符串数组，便于后续统一匹配 peerId/appid。
 */
function normalizeAllowFrom(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => String(entry).trim()).filter(Boolean);
}
