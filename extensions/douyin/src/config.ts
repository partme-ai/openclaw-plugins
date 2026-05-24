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
