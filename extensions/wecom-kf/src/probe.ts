/**
 * @module probe
 *
 * KF 账号健康探测（Phase 4 P4-02）：cursor、lastSync、凭证配置摘要。
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { getCursorStore } from "./cursor-store.js";
import { resolveKfAccountByOpenKfId, resolveWecomAccounts } from "./config/accounts.js";
import { resolveKfAgentAccount } from "./kf/call-context.js";
import { consumeAccountStatePatch } from "./webhook/callback.js";

export type KfAccountProbeResult = {
  accountKey: string;
  openKfId: string;
  configured: boolean;
  hasCursor: boolean;
  hasCorpSecret: boolean;
  lastSyncAt?: number;
  lastInboundAt?: number;
  lastError?: string;
};

/**
 * 探测单个 open_kfid 账号运行态。
 */
export async function probeWecomKfAccount(params: {
  cfg: OpenClawConfig;
  openKfId: string;
}): Promise<KfAccountProbeResult | undefined> {
  const openKfId = params.openKfId.trim();
  if (!openKfId) return undefined;

  const resolved = resolveKfAccountByOpenKfId({ cfg: params.cfg, openKfId });
  if (!resolved) return undefined;

  const cursorStore = getCursorStore();
  const cursorKey = `${resolved.accountKey}:${openKfId}`;
  const cursor = await cursorStore.getCursor(cursorKey);
  const runtimePatch = consumeAccountStatePatch(openKfId) ?? {};
  const agent = resolveKfAgentAccount(params.cfg, openKfId);

  return {
    accountKey: resolved.accountKey,
    openKfId,
    configured: resolved.config.enabled !== false && Boolean(resolved.config.openKfId),
    hasCursor: Boolean(cursor?.trim()),
    hasCorpSecret: Boolean(agent?.corpSecret?.trim()),
    lastSyncAt: runtimePatch.lastSyncAt as number | undefined,
    lastInboundAt: runtimePatch.lastInboundAt as number | undefined,
    lastError: runtimePatch.lastError as string | undefined,
  };
}

/**
 * 探测 channels.wecom-kf 下全部已配置账号。
 */
export async function probeWecomKfAccounts(cfg: OpenClawConfig): Promise<KfAccountProbeResult[]> {
  const resolved = resolveWecomAccounts(cfg);
  const results: KfAccountProbeResult[] = [];

  for (const account of Object.values(resolved.accounts)) {
    const openKfId = account.config.openKfId?.trim();
    if (!openKfId || account.enabled === false) continue;
    const probe = await probeWecomKfAccount({ cfg, openKfId });
    if (probe) results.push(probe);
  }

  return results;
}
