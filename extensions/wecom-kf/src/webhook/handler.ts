/**
 * @module wecom-kf/webhook/handler
 *
 * KF 回调 **sync_msg 编排层**（游标预热、批量拉取、并发派发）。
 *
 * **职责**：
 * - 维护账号运行时状态补丁（`trackAccountEvent` / `consumeAccountStatePatch`）
 * - 调用 `syncKfMessages` 拉取客户消息，经 dedup 后 `dispatchKfMessage` 或 `handleSystemEvent`
 * - 并发限制（`MSG_PROCESS_CONCURRENCY`）防止单批消息打满 CPU
 *
 * **上下游**：
 * - 上游：`webhook/callback.ts` 验签解密后的 POST
 * - 下游：`dispatch/inbound-dispatcher`、`state/cursor-store`、`dedup/kf-inbound-dedup`
 *
 * **关键导出**：`processKfSyncMessages`、`trackAccountEvent`
 */

import { syncKfMessages } from "../agent/api-client.js";
import type { ResolvedAgentAccount } from "../types/index.js";
import { dispatchKfMessage } from "../dispatch/inbound-dispatcher.js";
import { handleSystemEvent } from "../agent/system-event.js";
import { getCursorStore } from "../state/cursor-store.js";
import { claimWecomKfInboundMsgid } from "../dedup/kf-inbound-dedup.js";
import { resolveKfAccountByOpenKfId } from "../config/accounts.js";
import { getWecomRuntime } from "../runtime/index.js";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { KfMessage, WecomAccountConfig } from "../types/index.js";

/** 账号运行时状态补丁（供 channel status 消费） */
const accountStatePatches = new Map<string, Record<string, unknown>>();

/**
 * 消费并清除某账号的状态补丁。
 */
export function consumeAccountStatePatch(accountId: string): Record<string, unknown> | undefined {
  const patch = accountStatePatches.get(accountId);
  accountStatePatches.delete(accountId);
  return patch;
}

/**
 * 记录账号事件（同步时间、入站时间等）。
 */
export function trackAccountEvent(accountId: string, patch: Record<string, unknown>): void {
  const existing = accountStatePatches.get(accountId) ?? {};
  accountStatePatches.set(accountId, { ...existing, ...patch });
}

/** 同一批消息最大并发处理数 */
const MSG_PROCESS_CONCURRENCY = 8;

/**
 * 创建并发限制器：最多 concurrency 个 Promise 同时执行。
 */
function createLimit<T>(concurrency: number) {
  let running = 0;
  const queue: Array<() => void> = [];
  return (fn: () => Promise<T>): Promise<T> => {
    const run = (): Promise<T> => {
      running++;
      return fn().finally(() => {
        running--;
        if (queue.length > 0) queue.shift()!();
      });
    };
    if (running < concurrency) return run();
    return new Promise<T>((resolve, reject) => {
      queue.push(() => run().then(resolve).catch(reject));
    });
  };
}

/**
 * 从 KF 账号配置构造 Agent 凭证（供 syncKfMessages 使用）。
 */
function buildKfSyncAgent(accountConfig: WecomAccountConfig, accountId: string): ResolvedAgentAccount {
  const corpId = accountConfig.corpId ?? "";
  const corpSecret = accountConfig.corpSecret ?? "";
  return {
    accountId,
    enabled: true,
    configured: true,
    corpId,
    corpSecret,
    token: accountConfig.token ?? "",
    encodingAESKey: accountConfig.encodingAESKey ?? "",
    config: {
      corpId,
      corpSecret,
      token: accountConfig.token ?? "",
      encodingAESKey: accountConfig.encodingAESKey ?? "",
    },
  };
}

/**
 * 冷启动游标预热：将游标推进到最新，避免重放历史消息。
 */
export async function primeWecomKfCursor(params: {
  accountConfig: WecomAccountConfig;
}): Promise<void> {
  const { accountConfig } = params;
  const corpId = accountConfig.corpId?.trim();
  const corpSecret = accountConfig.corpSecret?.trim();
  const openKfId = accountConfig.openKfId?.trim();

  if (!corpId || !corpSecret || !openKfId) {
    return;
  }

  const cursorStore = getCursorStore();
  const existingCursor = await cursorStore.getCursor(openKfId);
  if (existingCursor) {
    return;
  }

  console.log(`[wecom_kf] Priming cursor for openKfId=${openKfId}`);

  try {
    const agent = buildKfSyncAgent(accountConfig, "kf-prime");
    let cursor = "";
    let hasMore = true;
    while (hasMore) {
      const result = await syncKfMessages(agent, { cursor, open_kfid: openKfId, limit: 1000 });
      if (result.next_cursor) {
        cursor = result.next_cursor;
        await cursorStore.saveCursor(openKfId, cursor);
      }
      hasMore = result.has_more === 1;
    }

    console.log(`[wecom_kf] Cursor primed for openKfId=${openKfId}`);
  } catch (error) {
    console.warn(
      `[wecom_kf] Cursor prime failed for openKfId=${openKfId}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * 按消息内 open_kfid 解析账号配置。
 */
function resolveMessageAccountConfig(
  msg: Record<string, unknown>,
  fallbackConfig: WecomAccountConfig,
): WecomAccountConfig {
  const openKfId = (msg.open_kfid as string | undefined)?.trim();
  try {
    const runtime = getWecomRuntime();
    const cfg = runtime.config as OpenClawConfig;
    const resolved = resolveKfAccountByOpenKfId({ cfg, openKfId });
    if (resolved?.config) {
      return resolved.config;
    }
  } catch {
    // runtime 未初始化时回退
  }
  return openKfId ? { ...fallbackConfig, openKfId } : fallbackConfig;
}

/**
 * 处理单条 sync_msg 消息。
 */
async function dispatchInboundMessage(
  msg: Record<string, unknown>,
  accountConfig: WecomAccountConfig,
): Promise<void> {
  const origin = msg.origin as number | undefined;
  const msgtype = msg.msgtype as string | undefined;
  const openKfId =
    (msg.open_kfid as string | undefined)?.trim() ?? accountConfig.openKfId?.trim() ?? "default";
  const effectiveAccountConfig = resolveMessageAccountConfig(msg, accountConfig);

  switch (origin) {
    case 3: {
      const msgId = (msg.msgid as string | undefined)?.trim();
      if (msgId) {
        const claimed = await claimWecomKfInboundMsgid(openKfId, msgId);
        if (!claimed) {
          console.log(`[wecom_kf] duplicate msgid=${msgId} open_kfid=${openKfId}; skipped`);
          return;
        }
      }
      trackAccountEvent(openKfId, { lastInboundAt: Date.now() });
      const runtime = getWecomRuntime();
      await dispatchKfMessage({
        cfg: runtime.config as OpenClawConfig,
        accountConfig: effectiveAccountConfig,
        msg: msg as KfMessage,
      });
      break;
    }

    case 4:
      if (msgtype === "event") {
        await handleSystemEvent(
          msg as Record<string, unknown> as Parameters<typeof handleSystemEvent>[0],
          effectiveAccountConfig,
        );
      }
      break;

    case 5:
      break;

    default:
      console.log(`[wecom_kf] Unknown origin: ${origin}`);
  }
}

/**
 * 处理 kf_msg_or_event：sync_msg 拉取并按 origin 分发。
 */
export async function processKfEvent(
  eventData: Record<string, unknown>,
  getAccountConfig: (openKfId?: string) => WecomAccountConfig | undefined,
): Promise<void> {
  const token = eventData.Token as string | undefined;
  const openKfId = eventData.OpenKfId as string | undefined;

  const accountConfig = getAccountConfig(openKfId) ?? getAccountConfig();
  if (!accountConfig) {
    console.error(`[wecom_kf] No config found for account: ${openKfId}`);
    return;
  }

  const agent = buildKfSyncAgent(accountConfig, "kf-callback");

  const cursorStore = getCursorStore();
  const kfId = openKfId ?? accountConfig.openKfId ?? "";
  let cursor: string | undefined = await cursorStore.getCursor(kfId);

  let hasMore = true;
  while (hasMore) {
    const syncResult = await syncKfMessages(agent, {
      cursor: cursor ?? "",
      token: cursor ? undefined : token,
      open_kfid: openKfId,
    });

    if (syncResult.errcode !== 0) {
      console.error(
        `[wecom_kf] sync_msg failed: ${syncResult.errmsg} (errcode: ${syncResult.errcode})`,
      );
      break;
    }

    const limit = createLimit<void>(MSG_PROCESS_CONCURRENCY);
    await Promise.all(
      syncResult.msg_list.map((msg) => limit(() => dispatchInboundMessage(msg, accountConfig))),
    );

    trackAccountEvent(accountConfig.openKfId ?? kfId, { lastSyncAt: Date.now() });

    if (syncResult.next_cursor) {
      cursor = syncResult.next_cursor;
      await cursorStore.saveCursor(kfId, cursor);
    }

    hasMore = syncResult.has_more === 1;
  }
}
