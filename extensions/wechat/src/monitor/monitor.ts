/**
 * @module wechat/monitor/monitor
 *
 * 微信通道 monitor 生命周期。
 */

import type { ChannelAccountSnapshot } from "openclaw/plugin-sdk/channel-contract";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";

import { getUpdates } from "../api/api.js";
import { WeixinConfigManager } from "../api/config-cache.js";
import { SESSION_EXPIRED_ERRCODE, pauseSession, getRemainingPauseMs } from "../api/session-guard.js";
import { processOneMessage } from "../messaging/process-message.js";
import { getWeixinRuntime, waitForWeixinRuntime } from "../runtime.js";
import { getSyncBufFilePath, loadGetUpdatesBuf, saveGetUpdatesBuf } from "../storage/sync-buf.js";
import { ProcessedMessageStore } from "../storage/processed-messages.js";
import { logger } from "../util/logger.js";
import type { Logger } from "../util/logger.js";
import { sanitizeLogMessage } from "../util/redact.js";

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const BACKOFF_DELAY_MS = 30_000;
const RETRY_DELAY_MS = 2_000;
const MIN_LONG_POLL_TIMEOUT_MS = 1_000;
const MAX_LONG_POLL_TIMEOUT_MS = 60_000;

export function clampLongPollTimeout(timeoutMs: number): number {
  return Math.min(MAX_LONG_POLL_TIMEOUT_MS, Math.max(MIN_LONG_POLL_TIMEOUT_MS, timeoutMs));
}

export async function processUpdateBatch<T>(params: {
  messages: T[];
  nextSyncBuf?: string;
  processMessage: (message: T) => Promise<void>;
  commitSyncBuf: (syncBuf: string) => void;
}): Promise<void> {
  for (const message of params.messages) {
    await params.processMessage(message);
  }
  // 空字符串也是合法游标：服务端会用它显式要求客户端重置同步上下文。
  // 只判断 truthy 会让本地继续使用旧游标，造成重复拉取或永久不同步。
  if (params.nextSyncBuf !== undefined) {
    params.commitSyncBuf(params.nextSyncBuf);
  }
}

export type MonitorWeixinOpts = {
  baseUrl: string;
  cdnBaseUrl: string;
  token?: string;
  accountId: string;
  /** When non-empty, only messages whose from_user_id is in this list are processed. */
  allowFrom?: string[];
  config: import("openclaw/plugin-sdk/core").OpenClawConfig;
  runtime?: { log?: (msg: string) => void; error?: (msg: string) => void };
  abortSignal?: AbortSignal;
  longPollTimeoutMs?: number;
  /** Gateway status callback — called on each successful poll and inbound message. */
  setStatus?: (next: ChannelAccountSnapshot) => void;
};

/**
 * Long-poll loop: getUpdates -> normalize -> recordInboundSession -> dispatchReplyFromConfig.
 * Runs until abort.
 */
export async function monitorWeixinProvider(opts: MonitorWeixinOpts): Promise<void> {
  const {
    baseUrl,
    cdnBaseUrl,
    token,
    accountId,
    config,
    abortSignal,
    longPollTimeoutMs,
    setStatus,
  } = opts;
  const log = opts.runtime?.log ?? (() => {});
  const errLog = opts.runtime?.error ?? ((m: string) => log(m));
  const aLog: Logger = logger.withAccount(accountId);

  aLog.info(`waiting for Weixin runtime...`);
  let channelRuntime: PluginRuntime["channel"];
  try {
    const pluginRuntime = await waitForWeixinRuntime();
    channelRuntime = pluginRuntime.channel;
    aLog.info(`Weixin runtime acquired, channelRuntime type: ${typeof channelRuntime}`);
  } catch (err) {
    aLog.error(`waitForWeixinRuntime() failed: ${String(err)}`);
    throw err;
  }

  log(`weixin monitor started (account=${accountId})`);
  aLog.info(
    `Monitor started: timeoutMs=${longPollTimeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS}`,
  );

  const syncFilePath = getSyncBufFilePath(accountId);
  const processedMessages = new ProcessedMessageStore(`${syncFilePath}.processed.json`);
  aLog.debug(`syncFilePath: ${syncFilePath}`);

  const previousGetUpdatesBuf = loadGetUpdatesBuf(syncFilePath);
  let getUpdatesBuf = previousGetUpdatesBuf ?? "";

  if (previousGetUpdatesBuf) {
    log(`[weixin] resuming from previous sync buf (${getUpdatesBuf.length} bytes)`);
    aLog.debug(`Using previous get_updates_buf (${getUpdatesBuf.length} bytes)`);
  } else {
    log(`[weixin] no previous sync buf, starting fresh`);
    aLog.info(`No previous get_updates_buf found, starting fresh`);
  }

  const configManager = new WeixinConfigManager({ baseUrl, token }, log);

  let nextTimeoutMs = longPollTimeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS;
  let consecutiveFailures = 0;

  while (!abortSignal?.aborted) {
    try {
      aLog.debug(`getUpdates: syncBufBytes=${getUpdatesBuf.length}, timeoutMs=${nextTimeoutMs}`);
      const resp = await getUpdates({
        baseUrl,
        token,
        get_updates_buf: getUpdatesBuf,
        timeoutMs: nextTimeoutMs,
      });
      aLog.debug(
        `getUpdates response: ret=${resp.ret}, msgs=${resp.msgs?.length ?? 0}, get_updates_buf_length=${resp.get_updates_buf?.length ?? 0}`,
      );

      if (resp.longpolling_timeout_ms != null && resp.longpolling_timeout_ms > 0) {
        nextTimeoutMs = clampLongPollTimeout(resp.longpolling_timeout_ms);
        aLog.debug(`Updated next poll timeout: ${nextTimeoutMs}ms`);
      }
      const isApiError =
        (resp.ret !== undefined && resp.ret !== 0) ||
        (resp.errcode !== undefined && resp.errcode !== 0);
      if (isApiError) {
        const isSessionExpired =
          resp.errcode === SESSION_EXPIRED_ERRCODE || resp.ret === SESSION_EXPIRED_ERRCODE;

        if (isSessionExpired) {
          pauseSession(accountId);
          const pauseMs = getRemainingPauseMs(accountId);
          errLog(
            `weixin getUpdates: session expired (errcode ${SESSION_EXPIRED_ERRCODE}), pausing bot for ${Math.ceil(pauseMs / 60_000)} min`,
          );
          aLog.error(
            `getUpdates: session expired (errcode=${resp.errcode} ret=${resp.ret}), pausing all requests for ${Math.ceil(pauseMs / 60_000)} min`,
          );
          consecutiveFailures = 0;
          await sleep(pauseMs, abortSignal);
          continue;
        }

        consecutiveFailures += 1;
        errLog(`weixin getUpdates failed: ret=${resp.ret} errcode=${resp.errcode} (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`);
        aLog.error(
          `getUpdates failed: ret=${resp.ret} errcode=${resp.errcode}`,
        );
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          errLog(
            `weixin getUpdates: ${MAX_CONSECUTIVE_FAILURES} consecutive failures, backing off 30s`,
          );
          aLog.error(
            `getUpdates: ${MAX_CONSECUTIVE_FAILURES} consecutive failures, backing off 30s`,
          );
          consecutiveFailures = 0;
          await sleep(BACKOFF_DELAY_MS, abortSignal);
        } else {
          await sleep(RETRY_DELAY_MS, abortSignal);
        }
        continue;
      }
      consecutiveFailures = 0;
      setStatus?.({ accountId, lastEventAt: Date.now() });
      const list = resp.msgs ?? [];
      await processUpdateBatch({
        messages: list,
        nextSyncBuf: resp.get_updates_buf,
        processMessage: async (full) => {
        const messageId = full.message_id == null ? undefined : String(full.message_id);
        if (messageId && processedMessages.has(messageId)) {
          aLog.info("inbound duplicate skipped");
          return;
        }
        aLog.info(`inbound message: types=${full.item_list?.map((i) => i.type).join(",") ?? "none"}`);

        const now = Date.now();
        setStatus?.({ accountId, lastEventAt: now, lastInboundAt: now });

        await processOneMessage(full, {
          accountId,
          config,
          channelRuntime,
          baseUrl,
          cdnBaseUrl,
          token,
          allowFrom: opts.allowFrom,
          // processOneMessage 在 DM 鉴权通过后才调用，避免未授权用户消耗 getConfig 配额。
          resolveTypingTicket: async (userId, contextToken) =>
            (await configManager.getForUser(userId, contextToken)).typingTicket,
          log: opts.runtime?.log ?? (() => {}),
          errLog,
        });
        if (messageId) processedMessages.mark(messageId);
        },
        // Commit only after the entire batch succeeds. A crash can replay already-
        // dispatched messages (at-least-once), but cannot skip the remainder.
        commitSyncBuf: (nextSyncBuf) => {
          saveGetUpdatesBuf(syncFilePath, nextSyncBuf);
          getUpdatesBuf = nextSyncBuf;
          aLog.debug(`Saved new get_updates_buf (${getUpdatesBuf.length} bytes)`);
        },
      });
    } catch (err) {
      if (abortSignal?.aborted) {
        aLog.info(`Monitor stopped (aborted)`);
        return;
      }
      consecutiveFailures += 1;
      errLog(sanitizeLogMessage(
        `weixin getUpdates error (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${String(err)}`,
      ));
      aLog.error(`getUpdates error: ${err instanceof Error ? err.message : String(err)}`);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        errLog(
          `weixin getUpdates: ${MAX_CONSECUTIVE_FAILURES} consecutive failures, backing off 30s`,
        );
        aLog.error(
          `getUpdates: ${MAX_CONSECUTIVE_FAILURES} consecutive failures, backing off 30s`,
        );
        consecutiveFailures = 0;
        await sleep(30_000, abortSignal);
      } else {
        await sleep(2000, abortSignal);
      }
    }
  }
  aLog.info(`Monitor ended`);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}
