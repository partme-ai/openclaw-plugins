/**
 * WeCom 多账号配置解析（accounts）
 *
 * 职责：列举/合并/写入 `channels.wecom` 与 `channels.wecom.accounts.*`，产出 `ResolvedWeComAccount`。
 *
 * 与 message-sdk：`mergeChannelAccountConfig` 来自 SDK config 包，负责顶层与账号级深层合并（含 groups）。
 * WeCom 特有的 Agent 子配置解析、enabled 逻辑保留在本模块。
 */

import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { mergeChannelAccountConfig } from "@partme.ai/openclaw-message-sdk/config";
import { CHANNEL_ID } from "../types/const.js";
import type { WeComConfig, WeComAccountConfig, ResolvedWeComAccount } from "./wecom-config.js";
import { DefaultWsUrl } from "./wecom-config.js";
import type { ResolvedAgentAccount } from "../types/account.js";
import type { WecomAgentConfig } from "../types/config.js";
import { flattenWecomBotFields } from "./bot-config-normalize.js";

/** Per cfg object: resolved account cache (invalidates when cfg reference changes). */
const resolvedAccountCache = new WeakMap<OpenClawConfig, Map<string, ResolvedWeComAccount>>();

/**
 * 从 WeakMap 读取或写入已解析账号，避免同一 cfg 快照重复 merge/flatten。
 */
function getCachedResolvedAccount(
  cfg: OpenClawConfig,
  accountId: string,
  resolve: () => ResolvedWeComAccount,
): ResolvedWeComAccount {
  let byAccount = resolvedAccountCache.get(cfg);
  if (!byAccount) {
    byAccount = new Map();
    resolvedAccountCache.set(cfg, byAccount);
  }
  const cached = byAccount.get(accountId);
  if (cached) {
    return cached;
  }
  const resolved = resolve();
  byAccount.set(accountId, resolved);
  return resolved;
}

// ============================================================================
// 多账号配置结构
// ============================================================================

/**
 * 企业微信多账号配置结构（扩展 WeComConfig）
 */
export interface WeComMultiAccountConfig extends WeComConfig {
  /** 默认账号 ID */
  defaultAccount?: string;
  /** 多账号配置 */
  accounts?: Record<string, WeComAccountConfig>;
}

// ============================================================================
// 账号列举
// ============================================================================

/**
 * 列出 accounts 字段中配置的所有账号 ID（已 normalize）。
 */
function listConfiguredAccountIds(cfg: OpenClawConfig): string[] {
  const accounts = (cfg.channels?.[CHANNEL_ID] as WeComMultiAccountConfig)?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return [];
  }
  return Object.keys(accounts).filter(Boolean).map(normalizeAccountId);
}

/**
 * 判断是否为多账号模式（即配置中存在 accounts 字段）。
 * 用于区分单账号/多账号模式的分支判断，替代 `accountId === DEFAULT_ACCOUNT_ID` 的不可靠判断。
 */
export function hasMultiAccounts(cfg: OpenClawConfig): boolean {
  return listConfiguredAccountIds(cfg).length > 0;
}

/**
 * 列出所有企业微信账号 ID。
 * 如果没有 accounts 字段，返回 [DEFAULT_ACCOUNT_ID] 以向后兼容。
 */
export function listWeComAccountIds(cfg: OpenClawConfig): string[] {
  const ids = listConfiguredAccountIds(cfg);
  if (ids.length === 0) {
    // 向后兼容：未配置 accounts 时使用默认账号
    return [DEFAULT_ACCOUNT_ID];
  }
  return [...ids].sort((a: string, b: string) => a.localeCompare(b));
}

// ============================================================================
// 默认账号解析
// ============================================================================

/**
 * 解析默认账号 ID。
 *
 * 优先级：
 * 1. 显式设置的 defaultAccount
 * 2. 包含 DEFAULT_ACCOUNT_ID 的账号列表
 * 3. 字母序第一个账号
 */
export function resolveDefaultWeComAccountId(cfg: OpenClawConfig): string {
  const wecomConfig = cfg.channels?.[CHANNEL_ID] as WeComMultiAccountConfig | undefined;
  const preferred = wecomConfig?.defaultAccount?.trim();
  if (preferred) {
    return normalizeAccountId(preferred);
  }
  const ids = listWeComAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) {
    return DEFAULT_ACCOUNT_ID;
  }
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

// ============================================================================
// 配置合并
// ============================================================================

/**
 * 合并顶层 channels.wecom 与 accounts[accountId]（账号级覆盖顶层）。
 *
 * @param cfg 全局配置
 * @param accountId 目标账号 ID（已 normalize 或由 findAccountConfig 匹配）
 */
function mergeWeComAccountConfig(cfg: OpenClawConfig, accountId: string): WeComConfig {
  const wecomConfig = cfg.channels?.[CHANNEL_ID] as WeComMultiAccountConfig | undefined;
  const { accounts: _ignored, defaultAccount: _da, ...base } = wecomConfig ?? {};
  const account = findAccountConfig(wecomConfig?.accounts, accountId);
  const normalizedBase = flattenWecomBotFields(base as Record<string, unknown>);
  const normalizedAccount = flattenWecomBotFields(account as Record<string, unknown>);
  return mergeChannelAccountConfig(
    normalizedBase as WeComConfig & Record<string, unknown>,
    normalizedAccount as Partial<WeComConfig & Record<string, unknown>>,
    ["groups"],
  );
}

/**
 * 在 accounts Record 中按 normalize 后的 accountId 查找配置。
 * 避免因大小写差异导致找不到账号。
 */
function findAccountConfig(
  accounts: Record<string, WeComAccountConfig> | undefined,
  accountId: string,
): WeComAccountConfig {
  if (!accounts) return {};
  // 精确匹配优先
  if (accounts[accountId]) return accounts[accountId];
  // normalize 后匹配
  const normalized = normalizeAccountId(accountId);
  for (const [key, value] of Object.entries(accounts)) {
    if (normalizeAccountId(key) === normalized) return value;
  }
  return {};
}

// ============================================================================
// 账号解析
// ============================================================================

/**
 * 解析单个企业微信账号的完整配置（多账号主入口）。
 *
 * @param params.cfg OpenClaw 全局配置
 * @param params.accountId 显式账号 ID；省略则使用 resolveDefaultWeComAccountId
 * @returns Bot + 可选 Agent 的 ResolvedWeComAccount
 */
export function resolveWeComAccountMulti(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedWeComAccount {
  const hasExplicitId = typeof params.accountId === "string" && params.accountId.trim() !== "";
  const accountId = hasExplicitId
    ? normalizeAccountId(params.accountId!)
    : resolveDefaultWeComAccountId(params.cfg);

  return getCachedResolvedAccount(params.cfg, accountId, () =>
    resolveWeComAccountMultiUncached(params.cfg, accountId),
  );
}

/**
 * 解析单个企业微信账号的完整配置（无缓存，供 {@link resolveWeComAccountMulti} 内部使用）。
 */
function resolveWeComAccountMultiUncached(
  cfg: OpenClawConfig,
  accountId: string,
): ResolvedWeComAccount {
  const wecomConfig = cfg.channels?.[CHANNEL_ID] as WeComMultiAccountConfig | undefined;

  // 顶层 enabled 状态
  const baseEnabled = wecomConfig?.enabled !== false;

  // 合并配置
  const merged = mergeWeComAccountConfig(cfg, accountId);

  // 账号级 enabled 状态
  const accountEnabled = merged.enabled !== false;

  // 解析 Agent 子配置：四项凭据齐全才标记 configured
  const agentCfg = merged.agent as WecomAgentConfig | undefined;
  let agent: ResolvedAgentAccount | undefined;
  if (agentCfg?.corpId && agentCfg?.corpSecret && agentCfg?.token && agentCfg?.encodingAESKey) {
    agent = {
      accountId,
      enabled: baseEnabled && accountEnabled,
      configured: true,
      corpId: agentCfg.corpId,
      corpSecret: agentCfg.corpSecret,
      agentId: typeof agentCfg.agentId === "string" ? Number(agentCfg.agentId) || undefined : agentCfg.agentId,
      token: agentCfg.token,
      encodingAESKey: agentCfg.encodingAESKey,
      config: agentCfg,
      network: merged.network,
    };
  }

  return {
    accountId,
    name: merged.name ?? "企业微信",
    enabled: baseEnabled && accountEnabled,
    websocketUrl: merged.websocketUrl || DefaultWsUrl,
    botId: merged.botId ?? "",
    secret: merged.secret ?? "",
    sendThinkingMessage: merged.sendThinkingMessage ?? true,
    config: merged,
    agent,
    token: merged.token ?? "",
    encodingAESKey: merged.encodingAESKey ?? "",
    receiveId: merged.receiveId ?? "",
  };
}

// ============================================================================
// 批量查询
// ============================================================================

/**
 * 列出所有已启用且已配置凭据的账号。
 */
export function listEnabledWeComAccounts(cfg: OpenClawConfig): ResolvedWeComAccount[] {
  return listWeComAccountIds(cfg)
    .map((accountId) => resolveWeComAccountMulti({ cfg, accountId }))
    .filter((account) => {
      if (!account.enabled) return false;
      const hasBotCredentials = Boolean(account.botId?.trim() && account.secret?.trim());
      const hasAgentCredentials = Boolean(account.agent?.configured);
      return hasBotCredentials || hasAgentCredentials;
    });
}

// ============================================================================
// 配置写入（多账号感知）
// ============================================================================

/**
 * 写入企业微信账户配置（自动区分单账号/多账号模式）。
 *
 * @param cfg 当前全局配置
 * @param updates 要写入的部分配置字段
 * @param accountId 目标账号 ID（默认写入默认账号）
 */
export function setWeComAccountMulti(
  cfg: OpenClawConfig,
  updates: Partial<WeComConfig>,
  accountId?: string,
): OpenClawConfig {
  const resolvedAccountId = accountId ?? resolveDefaultWeComAccountId(cfg);
  const isMulti = hasMultiAccounts(cfg);

  if (!isMulti) {
    // 单账号模式：合并到顶层
    const existing = (cfg.channels?.[CHANNEL_ID] ?? {}) as WeComConfig;
    const merged: WeComConfig = { ...existing, ...updates };
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        [CHANNEL_ID]: merged,
      },
    };
  }

  // 多账号模式：合并到 accounts[accountId]
  const wecomConfig = (cfg.channels?.[CHANNEL_ID] ?? {}) as WeComMultiAccountConfig;
  const existingAccount = wecomConfig.accounts?.[resolvedAccountId] ?? {};
  const mergedAccount: WeComAccountConfig = { ...existingAccount, ...updates };

  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      [CHANNEL_ID]: {
        ...wecomConfig,
        accounts: {
          ...wecomConfig.accounts,
          [resolvedAccountId]: mergedAccount,
        },
      },
    },
  };
}
