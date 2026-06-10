/**
 * KF 回调账号配置解析
 *
 * 从 channels.wecom-kf 读取 token / encodingAESKey / corpId 等，
 * 供 createKfCallbackHandler 验签解密与 sync_msg 拉取使用。
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { WecomAccountConfig } from "../types/index.js";
import { applyKfEnvVarFallback, DEFAULT_ACCOUNT_ID } from "./accounts.js";

type WecomKfChannelConfig = Record<string, unknown> & {
  corpId?: string;
  corpSecret?: string;
  token?: string;
  encodingAESKey?: string;
  openKfId?: string;
  defaultAccount?: string;
  accounts?: Record<string, Record<string, unknown>>;
};

/**
 * 合并渠道级与账号级 KF 字段，产出 callback 可用的扁平配置。
 */
function mergeKfAccountConfig(
  channel: WecomKfChannelConfig,
  accountEntry: Record<string, unknown> | undefined,
  accountId: string,
): WecomAccountConfig {
  const kfNested = (accountEntry?.kf ?? {}) as Record<string, unknown>;
  const merged = applyKfEnvVarFallback(
    {
      corpId: (accountEntry?.corpId ?? kfNested.corpId ?? channel.corpId) as string | undefined,
      corpSecret: (accountEntry?.corpSecret ?? kfNested.corpSecret ?? channel.corpSecret) as string | undefined,
      openKfId: (accountEntry?.openKfId ?? kfNested.openKfId ?? channel.openKfId) as string | undefined,
      token: (accountEntry?.token ?? kfNested.token ?? channel.token) as string | undefined,
      encodingAESKey: (accountEntry?.encodingAESKey ?? kfNested.encodingAESKey ?? channel.encodingAESKey) as
        | string
        | undefined,
      welcomeText: accountEntry?.welcomeText as string | undefined,
    },
    accountId,
  );
  return merged as WecomAccountConfig;
}

/**
 * 列出所有需预热的 KF 账号配置（去重 openKfId）。
 */
export function listKfAccountConfigs(cfg: OpenClawConfig | undefined): WecomAccountConfig[] {
  const channel = cfg?.channels?.["wecom-kf"] as WecomKfChannelConfig | undefined;
  if (!channel) return [];

  const results: WecomAccountConfig[] = [];
  const seenOpenKfIds = new Set<string>();
  const accounts = channel.accounts ?? {};

  for (const [accountId, entry] of Object.entries(accounts)) {
    const config = mergeKfAccountConfig(channel, entry, accountId);
    const openKfId = config.openKfId?.trim();
    if (!openKfId || seenOpenKfIds.has(openKfId)) continue;
    if (!config.token?.trim() || !config.encodingAESKey?.trim()) continue;
    seenOpenKfIds.add(openKfId);
    results.push(config);
  }

  const defaultAccountId = channel.defaultAccount?.trim() || DEFAULT_ACCOUNT_ID;
  const topLevel = mergeKfAccountConfig(channel, accounts[defaultAccountId], defaultAccountId);
  const topOpenKfId = topLevel.openKfId?.trim();
  if (
    topOpenKfId &&
    !seenOpenKfIds.has(topOpenKfId) &&
    topLevel.token?.trim() &&
    topLevel.encodingAESKey?.trim()
  ) {
    results.push(topLevel);
  } else if (results.length === 0 && topLevel.token?.trim() && topLevel.encodingAESKey?.trim()) {
    results.push(topLevel);
  }

  return results;
}

/**
 * 创建 KF 回调用的 getAccountConfig（按 OpenKfId 或默认账号解析）。
 */
export function createKfAccountConfigGetter(
  getConfig: () => OpenClawConfig | undefined,
): (openKfId?: string) => WecomAccountConfig | undefined {
  return (openKfId?: string) => {
    const cfg = getConfig();
    const channel = cfg?.channels?.["wecom-kf"] as WecomKfChannelConfig | undefined;
    if (!channel) return undefined;

    const normalizedOpenKfId = openKfId?.trim();
    const accounts = channel.accounts ?? {};

    if (normalizedOpenKfId) {
      for (const [accountId, entry] of Object.entries(accounts)) {
        const kfNested = (entry?.kf ?? {}) as Record<string, unknown>;
        const candidateOpenKfId = String(entry?.openKfId ?? kfNested.openKfId ?? "").trim();
        if (candidateOpenKfId === normalizedOpenKfId) {
          return mergeKfAccountConfig(channel, entry, accountId);
        }
      }
    }

    const defaultAccountId = channel.defaultAccount?.trim() || DEFAULT_ACCOUNT_ID;
    return mergeKfAccountConfig(channel, accounts[defaultAccountId], defaultAccountId);
  };
}
