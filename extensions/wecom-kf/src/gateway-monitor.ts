import type {
  ChannelGatewayContext,
  OpenClawConfig,
  PluginRuntime,
} from "openclaw/plugin-sdk";

import {
  detectMode,
  isLegacyWecomCsEnabled,
  listWecomAccountIds,
  resolveWecomAccount,
  resolveWecomAccountConflict,
  resolveKfAccountWebhookPath,
} from "./config/index.js";
import { primeWecomKfCursor } from "./webhook/callback.js";
import { listKfAccountConfigs } from "./config/kf-callback.js";
import type { ResolvedWecomAccount, WecomConfig } from "./types/index.js";
import { WEBHOOK_PATHS } from "./types/constants.js";

type AccountRouteRegistryItem = {
  botPaths: string[];
  agentPaths: string[];
};

const accountRouteRegistry = new Map<string, AccountRouteRegistryItem>();

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

function logRegisteredRouteSummary(
  ctx: ChannelGatewayContext<ResolvedWecomAccount>,
  preferredOrder: string[],
): void {
  const seen = new Set<string>();
  const orderedAccountIds = [
    ...preferredOrder.filter((accountId) => accountRouteRegistry.has(accountId)),
    ...Array.from(accountRouteRegistry.keys())
      .filter((accountId) => !seen.has(accountId))
      .sort((a, b) => a.localeCompare(b)),
  ].filter((accountId) => {
    if (seen.has(accountId)) return false;
    seen.add(accountId);
    return true;
  });

  const entries = orderedAccountIds
    .map((accountId) => {
      const routes = accountRouteRegistry.get(accountId);
      if (!routes) return undefined;
      const botText = routes.botPaths.length > 0 ? routes.botPaths.join(", ") : "未启用";
      const agentText = routes.agentPaths.length > 0 ? routes.agentPaths.join(", ") : "未启用";
      return `accountId=${accountId}（Bot: ${botText}；Agent: ${agentText}）`;
    })
    .filter((entry): entry is string => Boolean(entry));
  const summary = entries.length > 0 ? entries.join("； ") : "无";
  ctx.log?.info(`[${ctx.account.accountId}] 已注册账号路由汇总：${summary}`);
}

function resolveExpectedRouteSummaryAccountIds(cfg: OpenClawConfig): string[] {
  return listWecomAccountIds(cfg)
    .filter((accountId) => {
      const conflict = resolveWecomAccountConflict({ cfg, accountId });
      if (conflict) return false;
      const account = resolveWecomAccount({ cfg, accountId });
      if (!account.enabled || !account.configured) return false;
      return Boolean(account.bot?.configured || account.agent?.configured);
    })
    .sort((a, b) => a.localeCompare(b));
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

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
}

function resolveBotRegistrationPaths(params: { accountId: string; matrixMode: boolean }): string[] {
  if (params.matrixMode) {
    return uniquePaths([
      `${WEBHOOK_PATHS.BOT_PLUGIN}/${params.accountId}`,
      `${WEBHOOK_PATHS.BOT_ALT}/${params.accountId}`,
      WEBHOOK_PATHS.BOT_PLUGIN,
      WEBHOOK_PATHS.BOT,
      WEBHOOK_PATHS.BOT_ALT,
    ]);
  }
  return uniquePaths([WEBHOOK_PATHS.BOT_PLUGIN, WEBHOOK_PATHS.BOT, WEBHOOK_PATHS.BOT_ALT]);
}

function resolveAgentRegistrationPaths(params: { accountId: string; matrixMode: boolean }): string[] {
  if (params.matrixMode) {
    return uniquePaths([
      `${WEBHOOK_PATHS.AGENT_PLUGIN}/${params.accountId}`,
      `${WEBHOOK_PATHS.AGENT}/${params.accountId}`,
      WEBHOOK_PATHS.AGENT_PLUGIN,
      WEBHOOK_PATHS.AGENT,
    ]);
  }
  return uniquePaths([WEBHOOK_PATHS.AGENT_PLUGIN, WEBHOOK_PATHS.AGENT]);
}

/**
 * 账号生命周期：KF-only 默认路径；legacy wecom-cs 仅在开关开启时加载 monitor。
 */
export async function monitorWecomProvider(
  ctx: ChannelGatewayContext<ResolvedWecomAccount>,
): Promise<void> {
  const account = ctx.account;
  const cfg = ctx.cfg as OpenClawConfig;
  const expectedRouteSummaryAccountIds = resolveExpectedRouteSummaryAccountIds(cfg);
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
  const mode = detectMode(cfg.channels?.["wecom-kf"] as WecomConfig | undefined);
  const matrixMode = mode === "matrix";
  const bot = account.bot;
  const agent = account.agent;
  const botConfigured = Boolean(bot?.configured);
  const agentConfigured = Boolean(agent?.configured);

  if (mode === "legacy" && (botConfigured || agentConfigured)) {
    if (agentConfigured && !botConfigured) {
      ctx.log?.warn(
        `[${account.accountId}] 检测到仍在使用单 Agent 兼容模式。建议尽快升级为多账号模式：` +
        `将 channels.wecom-cs.agent 迁移到 channels.wecom-cs.accounts.<accountId>.agent，` +
        `并设置 channels.wecom-cs.defaultAccount。`,
      );
    } else {
      ctx.log?.warn(
        `[${account.accountId}] 检测到仍在使用单账号兼容模式。建议尽快升级为多账号模式：` +
        `将 channels.wecom-cs.bot/agent 迁移到 channels.wecom-cs.accounts.<accountId>.bot/agent，` +
        `并设置 channels.wecom-cs.defaultAccount。`,
      );
    }
  }

  const legacyCsEnabled = isLegacyWecomCsEnabled(cfg);
  const kfOnlyAccount = !botConfigured && !agentConfigured;

  void primeKfCursorsOnStartup(cfg, (message) => ctx.log?.info(message));

  if (kfOnlyAccount || !legacyCsEnabled) {
    if (!kfOnlyAccount && !legacyCsEnabled) {
      ctx.log?.warn(
        `[${account.accountId}] 检测到 Bot/Agent 配置但 legacyWecomCsEnabled=false；` +
          `仅 KF 回调生效。如需 wecom-cs 路径请设置 channels.wecom-kf.legacyWecomCsEnabled=true`,
      );
    }
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
    return;
  }

  const { registerAgentWebhookTarget, registerWecomWebhookTarget } = await import("./legacy/monitor.js");

  const unregisters: Array<() => void> = [];
  const botPaths: string[] = [];
  const agentPaths: string[] = [];
  try {
    if (bot && botConfigured) {
      const connectionMode = bot.connectionMode ?? "webhook";

      if (connectionMode === "webhook") {
        const paths = resolveBotRegistrationPaths({
          accountId: account.accountId,
          matrixMode,
        });
        for (const path of paths) {
          unregisters.push(
            registerWecomWebhookTarget({
              account: bot,
              config: cfg,
              runtime: ctx.runtime,
              core: {} as PluginRuntime,
              path,
              statusSink: (patch) => ctx.setStatus({ accountId: ctx.accountId, ...patch }),
            }),
          );
        }
        botPaths.push(...paths);
        ctx.log?.info(`[${account.accountId}] wecom bot webhook registered at ${paths.join(", ")}`);
      }
    }

    if (agent && agentConfigured) {
      const paths = resolveAgentRegistrationPaths({
        accountId: account.accountId,
        matrixMode,
      });
      for (const path of paths) {
        unregisters.push(
          registerAgentWebhookTarget({
            agent,
            config: cfg,
            runtime: ctx.runtime,
            path,
          }),
        );
      }
      agentPaths.push(...paths);
      ctx.log?.info(`[${account.accountId}] wecom agent webhook registered at ${paths.join(", ")}`);
    }

    accountRouteRegistry.set(account.accountId, { botPaths, agentPaths });
    const shouldLogSummary =
      expectedRouteSummaryAccountIds.length <= 1 ||
      expectedRouteSummaryAccountIds.every((accountId) => accountRouteRegistry.has(accountId));
    if (shouldLogSummary) {
      logRegisteredRouteSummary(ctx, expectedRouteSummaryAccountIds);
    }

    ctx.setStatus({
      accountId: account.accountId,
      running: true,
      configured: true,
      webhookPath: botConfigured
        ? (botPaths[0] ?? WEBHOOK_PATHS.BOT_PLUGIN)
        : (agentPaths[0] ?? WEBHOOK_PATHS.AGENT_PLUGIN),
      lastStartAt: Date.now(),
    });

    await waitForAbortSignal(ctx.abortSignal);
  } finally {
    for (const unregister of unregisters) {
      unregister();
    }
    accountRouteRegistry.delete(account.accountId);
    ctx.setStatus({
      accountId: account.accountId,
      running: false,
      lastStopAt: Date.now(),
    });
  }
}
