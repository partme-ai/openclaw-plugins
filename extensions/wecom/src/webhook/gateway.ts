/**
 * @module webhook/gateway
 *
 * Webhook Gateway **生命周期**管理（启停、Target 注册、flush 调度）。
 *
 * **职责**：
 * - 验证 token / encodingAESKey，注册多路径 Webhook Target
 * - 启动 prune 定时器与 dedup warmup
 * - 防抖 flush 时触发 `startAgentForStream`
 *
 * **与 message-sdk 关系**：
 * - 使用 `monitorState`（SDK StreamSessionMonitor 封装）管理队列
 * - dedup warmup 见 {@link warmupWecomWebhookDedupe}
 *
 * **关键流程**：`startWebhookGateway` → registerTarget → flushPending → Agent
 *
 * **关键导出**：`startWebhookGateway`、`stopWebhookGateway`、`getMonitorState`
 */

import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import type { WebhookGatewayContext, WecomWebhookTarget, PendingInbound } from "./types.js";
import { PRUNE_INTERVAL_MS, WEBHOOK_PATHS } from "./types.js";
import { monitorState, WebhookMonitorState } from "./state.js";
import { registerWecomWebhookTarget, hasActiveTargets } from "./target.js";
import { startAgentForStream } from "./monitor.js";
import { hasMultiAccounts } from "../config/accounts.js";
import { DEFAULT_ACCOUNT_ID } from "../shared/openclaw-compat.js";
import { getWeComRuntime } from "../runtime.js";

// ============================================================================
// 全局状态
// ============================================================================

/** 按 accountId 管理各账号的 Target 注销函数 */
const accountUnregisters = new Map<string, () => void>();

/** FlushHandler 是否已设置（只需设置一次，因为 monitorState 是单例） */
let flushHandlerInstalled = false;

// ============================================================================
// 路径解析
// ============================================================================

/**
 * 去除重复路径
 */
function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map((p) => p.trim()).filter(Boolean)));
}

/**
 * 解析 Bot Target 注册路径
 *
 * 多账号场景（matrixMode）下：注册带 accountId 后缀的路径 + 兼容老路径
 * 单账号场景下：只注册基础路径
 *
 * 参考 lh 版 resolveBotRegistrationPaths
 */
function resolveBotRegistrationPaths(params: {
  accountId: string;
  matrixMode: boolean;
}): string[] {
  if (params.matrixMode) {
    return uniquePaths([
      `${WEBHOOK_PATHS.BOT_PLUGIN}/${params.accountId}`,
      `${WEBHOOK_PATHS.BOT_ALT}/${params.accountId}`,
      // 兼容老路径：不带 accountId 后缀，签名验证会自动匹配到正确账号
      WEBHOOK_PATHS.BOT_PLUGIN,
      WEBHOOK_PATHS.BOT,
      WEBHOOK_PATHS.BOT_ALT,
    ]);
  }
  // 单账号模式：同时注册 /default 路径以支持显式指定
  return uniquePaths([
    WEBHOOK_PATHS.BOT_PLUGIN,
    WEBHOOK_PATHS.BOT,
    WEBHOOK_PATHS.BOT_ALT,
    `${WEBHOOK_PATHS.BOT_PLUGIN}/${DEFAULT_ACCOUNT_ID}`,
    `${WEBHOOK_PATHS.BOT_ALT}/${DEFAULT_ACCOUNT_ID}`,
  ]);
}

// ============================================================================
// 公共 API
// ============================================================================

/**
 * 获取当前的 MonitorState 实例（全局单例）。
 *
 * @returns Webhook 全局监控状态
 */
export function getMonitorState(): WebhookMonitorState {
  return monitorState;
}

/**
 * 启动 Webhook Gateway。
 *
 * WHY：多账号 matrix 模式需注册带 accountId 后缀的路径 + 老路径兼容，签名匹配才能
 * 路由到正确账号。
 *
 * @param ctx - Gateway 上下文（账号、config、runtime、setStatus）
 */
export function startWebhookGateway(ctx: WebhookGatewayContext): void {
  const { account, config, runtime } = ctx;
  const log = ctx.log ?? {
    info: (msg: string) => runtime.log(msg),
    error: (msg: string) => runtime.error(msg),
  };

  // 1. 验证必要配置（receiveId 非必填，可为空）
  if (!account.token || !account.encodingAESKey) {
    const missing: string[] = [];
    if (!account.token) missing.push("token");
    if (!account.encodingAESKey) missing.push("encodingAESKey");

    const errorMsg = `[webhook] Webhook 配置不完整，缺少: ${missing.join(", ")}`;
    log.error(errorMsg);

    ctx.setStatus?.({
      accountId: ctx.accountId,
      running: false,
      configured: false,
      lastError: errorMsg,
    });
    return;
  }

  log.info(`[webhook] 启动 Webhook Gateway (accountId=${ctx.accountId})`);

  void import("./dedup.js")
    .then(({ warmupWecomWebhookDedupe }) =>
      warmupWecomWebhookDedupe(ctx.accountId, (msg) => log.info(String(msg))),
    )
    .catch((err) => log.error(`[webhook] dedup warmup failed: ${String(err)}`));

  // 2. 确保 pruneTimer 启动（幂等：如果已在运行，不会重复启动）
  monitorState.startPruning(PRUNE_INTERVAL_MS);

  // FlushHandler 只需安装一次：monitorState 为全局单例，防抖结束统一走 flushPending
  if (!flushHandlerInstalled) {
    monitorState.streamStore.setFlushHandler((pending) => void flushPending(pending));
    flushHandlerInstalled = true;
  }

  // 4. 构造 Target 上下文
  const runtimeEnv = {
    log: (...args: unknown[]) => runtime.log(...args),
    error: (...args: unknown[]) => runtime.error(...args),
  };

  // 判断是否为多账号模式
  const matrixMode = hasMultiAccounts(ctx.config);

  const target: WecomWebhookTarget = {
    account,
    config,
    runtime: runtimeEnv,
    core: (ctx.channelRuntime ?? runtime) as any, // PluginRuntime 实例
    path: `${WEBHOOK_PATHS.BOT_PLUGIN}/${ctx.accountId}`, // 主路径（用于日志和状态显示）
    statusSink: ctx.setStatus
      ? (patch) => ctx.setStatus?.({ accountId: ctx.accountId, ...patch })
      : undefined,
  };

  // 5. 解析注册路径
  const paths = resolveBotRegistrationPaths({
    accountId: ctx.accountId,
    matrixMode,
  });

  // 6. 注册 Target（返回注销函数）
  // 如果该账号之前已注册（例如 reload），先注销
  const existingUnregister = accountUnregisters.get(ctx.accountId);
  if (existingUnregister) {
    existingUnregister();
  }

  const unregister = registerWecomWebhookTarget(target, paths);
  accountUnregisters.set(ctx.accountId, unregister);

  log.info(
    `[webhook] Webhook Target 已注册 (accountId=${ctx.accountId}, paths=[${paths.join(", ")}])`,
  );

  // 7. 更新状态
  ctx.setStatus?.({
    accountId: ctx.accountId,
    running: true,
    configured: true,
    webhookPath: paths[0],
    lastStartAt: Date.now(),
  });
}

/**
 * 停止 Webhook Gateway（仅注销当前 accountId 的 Target）。
 *
 * @param ctx - Gateway 上下文
 */
export function stopWebhookGateway(ctx: WebhookGatewayContext): void {
  const log = ctx.log ?? {
    info: (msg: string) => ctx.runtime.log(msg),
    error: (msg: string) => ctx.runtime.error(msg),
  };

  log.info(`[webhook] 停止 Webhook Gateway (accountId=${ctx.accountId})`);

  // 1. 注销该账号的 Target
  const unregister = accountUnregisters.get(ctx.accountId);
  if (unregister) {
    unregister();
    accountUnregisters.delete(ctx.accountId);
  }

  // 2. 如果没有任何活跃 Target，停止 pruneTimer
  if (!hasActiveTargets()) {
    monitorState.stopPruning();
  }

  // 3. 更新状态
  ctx.setStatus?.({
    accountId: ctx.accountId,
    running: false,
    lastStopAt: Date.now(),
  });
}

// ============================================================================
// flushPending 中间层（对齐原版 monitor.ts:1151-1192）
// ============================================================================

/**
 * 防抖窗口结束时的 flush 处理 — **核心 Agent 触发点**。
 *
 * WHY：同一 conversationKey 短时多条消息合并为一批，减少 Agent 调用次数；
 * 合并后的 `mergedContents` 作为单轮上下文输入。
 *
 * @param pending - 待 flush 的防抖批次（含 streamId、contents、target）
 */
async function flushPending(pending: PendingInbound): Promise<void> {
  const { streamId, target, msg, contents, msgids, conversationKey, batchKey } = pending;
  const { streamStore } = monitorState;

  // Merge all message contents (each is already formatted by buildInboundBody)
  const mergedContents = contents.filter(c => c.trim()).join("\n").trim();

  let core: PluginRuntime | null = null;
  try {
    core = getWeComRuntime();
  } catch (err) {
    target.runtime.log?.(
      `[webhook] flush pending: runtime not ready: ${String(err)}`,
    );
    streamStore.markFinished(streamId);
    target.runtime.log?.(
      `[webhook] queue: runtime not ready，结束批次并推进 streamId=${streamId}`,
    );
    streamStore.onStreamFinished(streamId);
    return;
  }

  if (core) {
    streamStore.markStarted(streamId);
    const enrichedTarget: WecomWebhookTarget = { ...target, core };
    target.runtime.log?.(
      `[webhook] flush pending: start batch streamId=${streamId} batchKey=${batchKey} conversationKey=${conversationKey} mergedCount=${contents.length}`,
    );

    // Pass the first msg (with its media structure), and mergedContents for multi-message context
    startAgentForStream({
      target: enrichedTarget,
      accountId: target.account.accountId,
      msg,
      streamId,
      mergedContents: contents.length > 1 ? mergedContents : undefined,
      mergedMsgids: msgids.length > 1 ? msgids : undefined,
    }).catch((err) => {
      streamStore.updateStream(streamId, (state) => {
        state.error = err instanceof Error ? err.message : String(err);
        state.content = state.content || `Error: ${state.error}`;
        state.finished = true;
      });
      target.runtime.error?.(
        `[webhook] Agent 处理失败 (streamId=${streamId}): ${String(err)}`,
      );
      streamStore.onStreamFinished(streamId);
    });
  }
}
