/**
 * 抖音渠道配置解析模块。
 *
 * **架构角色**：从 `openclaw.json` → `channels.douyin` 读取并合并多账号配置，
 * 产出 `ResolvedDouyinAccount` 供 `channel.ts` / `inbound.ts` 使用。
 *
 * **关键依赖**：`openclaw/plugin-sdk/account-resolution`、`./types`
 */
import {
  DEFAULT_ACCOUNT_ID,
  listCombinedAccountIds,
  normalizeAccountId,
  resolveMergedAccountConfig,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/account-resolution";
import type { DouyinChannelConfig, ResolvedDouyinAccount } from "./types.js";
import type { DouyinWebhookInboxConfig } from "./dispatch/webhook-inbox.js";

const DEFAULT_WEBHOOK_INBOX_CONFIG: DouyinWebhookInboxConfig = {
  maxPending: 1000,
  maxAttempts: 5,
  initialDelayMs: 1000,
  maxDelayMs: 60_000,
  maxDeadLetters: 100,
  maxStateBytes: 32 * 1024 * 1024,
};

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || (resolved as number) < minimum ||
      (resolved as number) > maximum) {
    throw new Error(`[douyin] ${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return resolved as number;
}

/** 解析账号级持久 Inbox 配置；运行时再次做范围校验，不能只依赖 manifest UI Schema。 */
export function resolveDouyinWebhookInboxConfig(
  account: ResolvedDouyinAccount,
): DouyinWebhookInboxConfig {
  const value = account.config.webhookDelivery ?? {};
  return {
    maxPending: boundedInteger(value.maxPending, DEFAULT_WEBHOOK_INBOX_CONFIG.maxPending, 1, 100_000, "webhookDelivery.maxPending"),
    maxAttempts: boundedInteger(value.maxAttempts, DEFAULT_WEBHOOK_INBOX_CONFIG.maxAttempts, 1, 100, "webhookDelivery.maxAttempts"),
    initialDelayMs: boundedInteger(value.initialDelayMs, DEFAULT_WEBHOOK_INBOX_CONFIG.initialDelayMs, 100, 300_000, "webhookDelivery.initialDelayMs"),
    maxDelayMs: boundedInteger(value.maxDelayMs, DEFAULT_WEBHOOK_INBOX_CONFIG.maxDelayMs, 1000, 3_600_000, "webhookDelivery.maxDelayMs"),
    maxDeadLetters: boundedInteger(value.maxDeadLetters, DEFAULT_WEBHOOK_INBOX_CONFIG.maxDeadLetters, 1, 10_000, "webhookDelivery.maxDeadLetters"),
    maxStateBytes: boundedInteger(value.maxStateBytes, DEFAULT_WEBHOOK_INBOX_CONFIG.maxStateBytes, 1_048_576, 1_073_741_824, "webhookDelivery.maxStateBytes"),
  };
}

/** 读取 channels.douyin 原始配置节 */
function getChannelSection(cfg: OpenClawConfig): DouyinChannelConfig {
  return ((cfg.channels as Record<string, unknown> | undefined)?.douyin ?? {}) as DouyinChannelConfig;
}

/**
 * 顶层同时存在 app_key + app_secret 时，隐式创建 `default` 账号 id。
 */
function resolveImplicitAccountId(section: DouyinChannelConfig): string | undefined {
  return section.app_key && section.app_secret ? DEFAULT_ACCOUNT_ID : undefined;
}

/**
 * 列出已配置账号 id（含隐式 default 与 accounts 子键）。
 *
 * @param cfg OpenClaw 全局配置
 * @returns 账号 id 列表，无配置时可能为空数组
 */
export function listDouyinAccountIds(cfg: OpenClawConfig): string[] {
  const section = getChannelSection(cfg);
  return listCombinedAccountIds({
    configuredAccountIds: Object.keys(section.accounts ?? {}),
    implicitAccountId: resolveImplicitAccountId(section),
  });
}

/** 获取未合并的 per-account 原始配置（供 DM 策略等字段回读） */
function getRawAccountConfig(
  channelCfg: DouyinChannelConfig,
  accountId: string,
): DouyinChannelConfig {
  if (accountId === DEFAULT_ACCOUNT_ID) {
    return channelCfg;
  }
  return { ...channelCfg, ...(channelCfg.accounts?.[accountId] ?? {}) };
}

function normalizeWebhookPath(value: string): string {
  const normalized = value.trim();
  if (
    !normalized.startsWith("/") ||
    normalized.startsWith("//") ||
    /[\\\s?#]/.test(normalized)
  ) {
    throw new Error(
      "[douyin] webhook_path must be an absolute path without whitespace, query, fragment, or backslash",
    );
  }
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

/**
 * 解析单个抖音账号（合并 channel 顶层 + accounts.<id> 覆盖）。
 *
 * @param cfg OpenClaw 全局配置
 * @param accountId 目标账号 id；省略时使用 default
 * @returns 含 webhook_path、configured 标志的解析结果
 */
export function resolveDouyinAccount(
  cfg: OpenClawConfig,
  accountId?: string | null,
): ResolvedDouyinAccount {
  const channelCfg = getChannelSection(cfg);
  const id = normalizeAccountId(accountId ?? DEFAULT_ACCOUNT_ID);
  const merged = resolveMergedAccountConfig<DouyinChannelConfig>({
    channelConfig: channelCfg,
    accounts: channelCfg.accounts,
    accountId: id,
  });

  const app_key = merged.app_key ?? "";
  const app_secret = merged.app_secret ?? "";
  const baseWebhookPath = normalizeWebhookPath(
    typeof channelCfg.webhook_path === "string" && channelCfg.webhook_path.trim()
      ? channelCfg.webhook_path
      : "/channels/douyin/webhook",
  );
  const accountWebhookPath = channelCfg.accounts?.[id]?.webhook_path;
  const webhook_path = normalizeWebhookPath(
    typeof accountWebhookPath === "string" && accountWebhookPath.trim()
      ? accountWebhookPath
      : id === DEFAULT_ACCOUNT_ID
        ? baseWebhookPath
        : `${baseWebhookPath}/${encodeURIComponent(id)}`,
  );

  return {
    accountId: id,
    enabled: merged.enabled ?? true,
    configured: Boolean(app_key && app_secret),
    app_key,
    app_secret,
    account_id: merged.account_id ?? merged.shop_id,
    poi_id: merged.poi_id,
    shop_id: merged.shop_id,
    webhook_path,
    config: getRawAccountConfig(channelCfg, id),
  };
}

/**
 * 解析默认账号 id（列表首项，或 DEFAULT_ACCOUNT_ID）。
 *
 * @param cfg OpenClaw 全局配置
 * @returns 默认账号 id
 */
export function resolveDefaultDouyinAccountId(cfg: OpenClawConfig): string {
  const ids = listDouyinAccountIds(cfg);
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}
