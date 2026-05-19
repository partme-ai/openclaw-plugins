/**
 * 从 channels.douyin 解析账号（支持顶层 + accounts.<id> 合并）。
 */
import {
  DEFAULT_ACCOUNT_ID,
  listCombinedAccountIds,
  normalizeAccountId,
  resolveMergedAccountConfig,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/account-resolution";
import type { DouyinChannelConfig, ResolvedDouyinAccount } from "./types.js";

function getChannelSection(cfg: OpenClawConfig): DouyinChannelConfig {
  return ((cfg.channels as Record<string, unknown> | undefined)?.douyin ?? {}) as DouyinChannelConfig;
}

function resolveImplicitAccountId(section: DouyinChannelConfig): string | undefined {
  return section.app_key && section.app_secret ? DEFAULT_ACCOUNT_ID : undefined;
}

/**
 * 列出已配置账号 id（含隐式 default）。
 */
export function listDouyinAccountIds(cfg: OpenClawConfig): string[] {
  const section = getChannelSection(cfg);
  return listCombinedAccountIds({
    configuredAccountIds: Object.keys(section.accounts ?? {}),
    implicitAccountId: resolveImplicitAccountId(section),
  });
}

function getRawAccountConfig(
  channelCfg: DouyinChannelConfig,
  accountId: string,
): DouyinChannelConfig {
  if (accountId === DEFAULT_ACCOUNT_ID) {
    return channelCfg;
  }
  return { ...channelCfg, ...(channelCfg.accounts?.[accountId] ?? {}) };
}

/**
 * 解析单个账号（合并 base + account 覆盖）。
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
  const webhook_path =
    (typeof merged.webhook_path === "string" && merged.webhook_path.trim()
      ? merged.webhook_path.trim()
      : undefined) ?? "/channels/douyin/webhook";

  return {
    accountId: id,
    enabled: merged.enabled ?? true,
    configured: Boolean(app_key && app_secret),
    app_key,
    app_secret,
    shop_id: merged.shop_id,
    webhook_path,
    config: getRawAccountConfig(channelCfg, id),
  };
}

export function resolveDefaultDouyinAccountId(cfg: OpenClawConfig): string {
  const ids = listDouyinAccountIds(cfg);
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}
