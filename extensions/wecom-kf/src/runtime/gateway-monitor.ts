import type {
  ChannelGatewayContext,
  OpenClawConfig,
} from "openclaw/plugin-sdk";

import {
  listWecomAccountIds,
  resolveWecomAccount,
  resolveWecomAccountConflict,
  resolveKfAccountWebhookPath,
} from "../config/index.js";
import { primeWecomKfCursor } from "../webhook/callback.js";
import { listKfAccountConfigs } from "../config/kf-callback.js";
import type { ResolvedWecomAccount } from "../types/index.js";

/** 避免多账号并行启动时重复预热 KF 游标 */
let kfCursorPrimeStarted = false;

async function primeKfCursorsOnStartup(
  cfg: OpenClawConfig,
  log?: (message: string) => void,
): Promise<void> {
  if (kfCursorPrimeStarted) return;
  kfCursorPrimeStarted = true;

  const kfAccounts = listKfAccountConfigs(cfg);
  if (kfAccounts.length === 0) return;

  for (const accountConfig of kfAccounts) {
    try {
      await primeWecomKfCursor({ accountConfig });
    } catch (error) {
      log?.(
        `[wecom_kf] Cursor prime failed for openKfId=${accountConfig.openKfId ?? "default"}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

function waitForAbortSignal(abortSignal: AbortSignal): Promise<void> {
  if (abortSignal.aborted) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const onAbort = () => {
      abortSignal.removeEventListener("abort", onAbort);
      resolve();
    };
    abortSignal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * 账号生命周期：KF-only；Legacy Bot/Agent 路径已移除。
 */
export async function monitorWecomProvider(
  ctx: ChannelGatewayContext<ResolvedWecomAccount>,
): Promise<void> {
  const account = ctx.account;
  const cfg = ctx.cfg as OpenClawConfig;
  const conflict = resolveWecomAccountConflict({
    cfg,
    accountId: account.accountId,
  });
  if (conflict) {
    ctx.setStatus({
      accountId: account.accountId,
      running: false,
      configured: false,
      lastError: conflict.message,
    });
    throw new Error(conflict.message);
  }

  const botConfigured = Boolean(account.bot?.configured);
  const agentConfigured = Boolean(account.agent?.configured);
  if (botConfigured || agentConfigured) {
    ctx.log?.warn(
      `[${account.accountId}] 检测到 Bot/Agent 配置，但 Legacy wecom-cs 路径已移除；` +
        `仅 KF 回调与 KF 出站生效。请迁移至 KF 凭证或移除过时的 bot/agent 配置块。`,
    );
  }

  void primeKfCursorsOnStartup(cfg, (message) => ctx.log?.info(message));

  const webhookPath = resolveKfAccountWebhookPath({
    accountId: account.accountId,
    webhookPath: account.config.webhookPath,
  });
  ctx.setStatus({
    accountId: account.accountId,
    running: true,
    configured: account.configured,
    webhookPath,
    lastStartAt: Date.now(),
  });
  ctx.log?.info(`[${account.accountId}] wecom-kf KF-only mode; webhookPath=${webhookPath}`);

  await waitForAbortSignal(ctx.abortSignal);

  ctx.setStatus({
    accountId: account.accountId,
    running: false,
    lastStopAt: Date.now(),
  });
}

/** @internal 供测试校验 matrix 账号冲突检测仍可用 */
export function resolveExpectedRouteSummaryAccountIds(cfg: OpenClawConfig): string[] {
  return listWecomAccountIds(cfg)
    .filter((accountId) => {
      const conflict = resolveWecomAccountConflict({ cfg, accountId });
      if (conflict) return false;
      const resolved = resolveWecomAccount({ cfg, accountId });
      if (!resolved.enabled || !resolved.configured) return false;
      return Boolean(resolved.bot?.configured || resolved.agent?.configured);
    })
    .sort((a, b) => a.localeCompare(b));
}
