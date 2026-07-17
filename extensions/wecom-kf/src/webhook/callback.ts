/**
 * HTTP 回调处理器
 * 接收企微 kf_msg_or_event 回调通知（文档 97712、94670），端点：/wecom/kefu
 *
 * 流程：验签解密 → 快速 200 → sync_msg(has_more) → dedup → origin 分发
 * 对齐 research/openclaw-china/extensions/wecom-kf/src/webhook.ts
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import {
  DEFAULT_WEBHOOK_MAX_BODY_BYTES,
  readRequestBodyWithLimit,
} from "@partme.ai/openclaw-message-sdk";
import type { WecomAccountConfig } from "../types/index.js";
import { parseWecomCallback } from "../webhook/crypto.js";
import { syncKfMessages } from "../agent/api-client.js";
import { getCursorStore } from "../state/cursor-store.js";
import { dispatchKfMessage } from "../dispatch/inbound-dispatcher.js";
import { handleSystemEvent } from "../agent/system-event.js";
import { resolveKfAccountByOpenKfId } from "../config/accounts.js";
import {
  claimWecomKfInboundMsgid,
  commitWecomKfInboundMsgid,
  releaseWecomKfInboundMsgid,
} from "../dedup/kf-inbound-dedup.js";
import { resolveKfAgentAccount } from "../tools/call-context.js";
import { getWecomRuntime } from "../runtime/index.js";
import type { KfMessage } from "../types/index.js";
import { toSafeErrorSummary } from "../shared/safe-log.js";

/** Account state tracking — updates via channel setStatus */
const accountStatePatches = new Map<string, Record<string, unknown>>();
const accountSyncQueues = new Map<string, Promise<void>>();
const MAX_SYNC_PAGES = 100;
const DEFAULT_CALLBACK_MAX_TIMESTAMP_SKEW_SECONDS = 300;
const DEFAULT_SYNC_RETRY_ATTEMPTS = 3;
const DEFAULT_SYNC_RETRY_DELAY_MS = 500;
const MAX_SYNC_RETRY_DELAY_MS = 30_000;
const DEFAULT_CALLBACK_DRAIN_TIMEOUT_MS = 30_000;
let acceptingBackgroundSync = true;

/**
 * 打开回调后台同步入口。由插件 Service start 调用；独立使用 handler 的测试和兼容入口默认开启。
 */
export function startKfCallbackProcessing(): void {
  acceptingBackgroundSync = true;
}

/**
 * 停止接收新的快速 ACK 后台任务，并等待已经 ACK 的账号串行队列完成。
 *
 * 若 Gateway 在 ACK 后直接退出，企微不会再次投递该通知，而尚未完成的 sync_msg/Agent 回复会
 * 丢失。因此 Service stop 必须 drain；超时则明确失败，不能伪装成优雅停机。
 */
export async function stopKfCallbackProcessing(
  timeoutMs = DEFAULT_CALLBACK_DRAIN_TIMEOUT_MS,
): Promise<void> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new Error("wecom-kf callback drain timeout must be an integer between 1 and 300000");
  }
  acceptingBackgroundSync = false;
  const pending = [...accountSyncQueues.values()];
  if (pending.length === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled(pending).then(() => undefined),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`wecom-kf callback drain timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function trackAccountStatePatch(accountId: string, patch: Record<string, unknown>): void {
  const existing = accountStatePatches.get(accountId) ?? {};
  accountStatePatches.set(accountId, { ...existing, ...patch });
}

export function consumeAccountStatePatch(accountId: string): Record<string, unknown> | undefined {
  const patch = accountStatePatches.get(accountId);
  accountStatePatches.delete(accountId);
  return patch;
}

function trackAccountEvent(accountId: string, patch: Record<string, unknown>): void {
  trackAccountStatePatch(accountId, patch);
}

function buildCursorKey(accountKey: string, openKfId: string): string {
  return `${accountKey}:${openKfId}`;
}

function assertCursorProgress(params: {
  current?: string;
  next?: string;
  hasMore: boolean;
  page: number;
}): void {
  if (!params.hasMore) return;
  if (!params.next?.trim()) {
    throw new Error(`sync_msg page ${params.page} has_more=1 without next_cursor`);
  }
  if (params.next === params.current) {
    throw new Error(`sync_msg page ${params.page} did not advance next_cursor`);
  }
}

function enqueueAccountSync(key: string, task: () => Promise<void>): boolean {
  if (!acceptingBackgroundSync) return false;
  const previous = accountSyncQueues.get(key) ?? Promise.resolve();
  const next = previous.then(task, task);
  accountSyncQueues.set(key, next);
  void next
    .catch((error: unknown) => {
      console.error(`[wecom_kf] background sync failed: ${toSafeErrorSummary(error)}`);
    })
    .finally(() => {
      if (accountSyncQueues.get(key) === next) accountSyncQueues.delete(key);
    });
  return true;
}

/**
 * 回调已快速 ACK 后的有界重拉策略。
 *
 * 每次尝试都会重新读取磁盘 cursor：前一轮已完成的页不会倒退，页内已提交 msgid 也会被持久
 * 去重跳过；只有最终仍失败时才交给队列记录一次脱敏错误，避免单次网络抖动造成消息滞留。
 */
async function retryAccountSync(
  task: () => Promise<void>,
  attempts: number,
  initialDelayMs: number,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await task();
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      const delay = Math.min(initialDelayMs * 2 ** (attempt - 1), MAX_SYNC_RETRY_DELAY_MS);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delay);
        timer.unref?.();
      });
    }
  }
  throw lastError;
}

/**
 * 创建回调处理函数
 */
export function createKfCallbackHandler(
  getAccountConfig: (openKfId?: string) => WecomAccountConfig | undefined,
  options: {
    nowSeconds?: () => number;
    maxTimestampSkewSeconds?: number;
    /** 快速 ACK 后后台 sync_msg 的总尝试次数（含首次）。 */
    syncRetryAttempts?: number;
    /** 首次重试等待时间；后续按 2 倍增长并限制在 30 秒。 */
    syncRetryDelayMs?: number;
  } = {},
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const syncRetryAttempts = options.syncRetryAttempts ?? DEFAULT_SYNC_RETRY_ATTEMPTS;
  const syncRetryDelayMs = options.syncRetryDelayMs ?? DEFAULT_SYNC_RETRY_DELAY_MS;
  if (!Number.isInteger(syncRetryAttempts) || syncRetryAttempts < 1 || syncRetryAttempts > 10) {
    throw new Error("wecom-kf syncRetryAttempts must be an integer between 1 and 10");
  }
  if (!Number.isInteger(syncRetryDelayMs) || syncRetryDelayMs < 0 || syncRetryDelayMs > MAX_SYNC_RETRY_DELAY_MS) {
    throw new Error("wecom-kf syncRetryDelayMs must be an integer between 0 and 30000");
  }
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const query = {
        msg_signature: url.searchParams.get("msg_signature") ?? undefined,
        timestamp: url.searchParams.get("timestamp") ?? undefined,
        nonce: url.searchParams.get("nonce") ?? undefined,
        echostr: url.searchParams.get("echostr") ?? undefined,
      };

      const body = req.method === "GET"
        ? null
        : await readRequestBodyWithLimit(req, { maxBytes: DEFAULT_WEBHOOK_MAX_BODY_BYTES });
      const defaultConfig = getAccountConfig();
      if (!defaultConfig) {
        console.error("[wecom_kf] No default account config found");
        res.writeHead(500);
        res.end("No account config");
        return;
      }
      assertFreshCallbackTimestamp(
        query.timestamp,
        options.nowSeconds?.() ?? Math.floor(Date.now() / 1000),
        options.maxTimestampSkewSeconds ?? DEFAULT_CALLBACK_MAX_TIMESTAMP_SKEW_SECONDS,
      );

      const parsed = parseWecomCallback(
        query,
        body,
        defaultConfig.token ?? "",
        defaultConfig.encodingAESKey ?? "",
        defaultConfig.corpId ?? "",
      );

      if (parsed.type === "verify") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(parsed.echostr);
        return;
      }

      const eventData = parsed.data as Record<string, unknown> | undefined;

      if (eventData?.Event === "kf_msg_or_event") {
        const boundOpenKfId = defaultConfig.openKfId?.trim();
        const eventOpenKfId = (eventData.OpenKfId as string | undefined)?.trim();
        if (!boundOpenKfId || !eventOpenKfId || eventOpenKfId !== boundOpenKfId) {
          // 回调路径已经绑定账号，解密后的 OpenKfId 只能用于一致性校验，不能再次切换账号。
          // 否则持有 A 账号回调 Token 的请求可伪造 B 的 OpenKfId，越权触发 B 的 corpSecret。
          throw new Error("callback open_kfid does not match the route-bound account");
        }
        const queueKey = boundOpenKfId;
        const accepted = enqueueAccountSync(queueKey, () => retryAccountSync(
          () => processKfEvent(eventData, defaultConfig),
          syncRetryAttempts,
          syncRetryDelayMs,
        ));
        if (!accepted) {
          // 尚未 ACK，返回 503 让企微稍后重投；此时不能回 success，否则停机窗口会丢通知。
          res.writeHead(503, { "Content-Type": "text/plain" });
          res.end("service stopping");
          return;
        }
      }

      if (eventData?.Event === "kf_account_auth_change") {
        const authAdd = (eventData.AuthAddOpenKfId as string)?.trim();
        const authDel = (eventData.AuthDelOpenKfId as string)?.trim();
        if (authAdd) console.log("[wecom_kf] KF account authorized");
        if (authDel) console.log("[wecom_kf] KF account deauthorized");
      }

      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("success");
    } catch (error) {
      console.warn(`[wecom_kf] rejected callback: ${toSafeErrorSummary(error)}`);
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("invalid callback");
    }
  };
}

function assertFreshCallbackTimestamp(
  timestamp: string | undefined,
  nowSeconds: number,
  maxSkewSeconds: number,
): void {
  if (!timestamp || !/^\d{1,16}$/.test(timestamp)) {
    throw new Error("invalid callback timestamp");
  }
  const parsed = Number(timestamp);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("invalid callback timestamp");
  }
  if (!Number.isFinite(maxSkewSeconds) || maxSkewSeconds < 0) {
    throw new Error("invalid callback timestamp skew configuration");
  }
  if (Math.abs(nowSeconds - parsed) > maxSkewSeconds) {
    throw new Error("stale callback timestamp");
  }
}

/**
 * 处理 kf_msg_or_event：sync_msg 分页拉取 + dedup + origin 分发
 */
async function processKfEvent(
  eventData: Record<string, unknown>,
  accountConfig: WecomAccountConfig,
): Promise<void> {
  const callbackToken = eventData.Token as string | undefined;
  const openKfId = (eventData.OpenKfId as string | undefined)?.trim();

  const effectiveOpenKfId = accountConfig.openKfId?.trim() || "";
  if (!effectiveOpenKfId) {
    throw new Error("cannot pull messages without open_kfid");
  }

  let runtime;
  let cfg: OpenClawConfig;
  try {
    runtime = getWecomRuntime();
    cfg = runtime.config.current() as OpenClawConfig;
  } catch {
    // Service 初始化与回调可能短暂竞态；进入有界重试，不能吞掉已经快速 ACK 的通知。
    throw new Error("Runtime not available for sync_msg");
  }

  const agent = resolveKfAgentAccount(cfg, effectiveOpenKfId);
  if (!agent) {
    throw new Error(
      "cannot pull messages before corpSecret is configured; finish callback verification, then configure corpSecret",
    );
  }

  const kfResolved = resolveKfAccountByOpenKfId({ cfg, openKfId: effectiveOpenKfId });
  const accountKey = kfResolved?.accountKey ?? "default";
  const cursorStore = getCursorStore();
  const cursorKey = buildCursorKey(accountKey, effectiveOpenKfId);
  let cursor = (await cursorStore.getCursor(cursorKey)) || undefined;
  let hasMore = true;
  let page = 0;

  while (hasMore && page < MAX_SYNC_PAGES) {
    page += 1;
    const syncResult = await syncKfMessages(agent, {
      cursor,
      token: !cursor ? callbackToken : undefined,
      open_kfid: effectiveOpenKfId,
      limit: 1000,
    });

    if (syncResult.errcode !== 0) {
      throw new Error(`sync_msg failed (errcode=${syncResult.errcode})`);
    }

    for (const msg of syncResult.msg_list) {
      await processSyncedMessage(msg, accountConfig, cfg, runtime);
    }

    trackAccountEvent(effectiveOpenKfId, { lastSyncAt: Date.now() });

    const nextCursor = syncResult.next_cursor?.trim();
    hasMore = syncResult.has_more === 1;
    assertCursorProgress({ current: cursor, next: nextCursor, hasMore, page });
    if (nextCursor) {
      cursor = nextCursor;
      await cursorStore.saveCursor(cursorKey, cursor);
    }
  }
  if (hasMore) throw new Error(`sync_msg exceeded ${MAX_SYNC_PAGES} pages`);
}

function resolveMessageAccountConfig(
  msg: KfSyncMsgLike,
  fallbackConfig: WecomAccountConfig,
  cfg: OpenClawConfig,
): WecomAccountConfig {
  const openKfId = msg.open_kfid?.trim();
  const resolved = resolveKfAccountByOpenKfId({ cfg, openKfId });
  if (resolved?.config) return resolved.config;
  return openKfId ? { ...fallbackConfig, openKfId } : fallbackConfig;
}

type KfSyncMsgLike = {
  msgid?: string;
  open_kfid?: string;
  origin?: number;
  msgtype?: string;
  [key: string]: unknown;
};

async function processSyncedMessage(
  msg: KfSyncMsgLike,
  accountConfig: WecomAccountConfig,
  cfg: OpenClawConfig,
  runtime: ReturnType<typeof getWecomRuntime>,
): Promise<void> {
  const msgId = msg.msgid?.trim();
  const openKfId = msg.open_kfid?.trim() ?? accountConfig.openKfId?.trim() ?? "default";

  if (msgId) {
    const claim = await claimWecomKfInboundMsgid(openKfId, msgId);
    if (claim.kind !== "claimed") {
      console.log(`[wecom_kf] inbound message skipped by dedupe (${claim.kind})`);
      return;
    }
  }

  const effectiveAccountConfig = resolveMessageAccountConfig(msg, accountConfig, cfg);
  const origin = msg.origin;
  const msgtype = msg.msgtype;

  try {
    switch (origin) {
    case 3:
      trackAccountEvent(openKfId, { lastInboundAt: Date.now() });
      await dispatchKfMessage({
        cfg,
        accountConfig: effectiveAccountConfig,
        msg: msg as KfMessage,
        core: runtime,
      });
      break;

    case 4:
      if (msgtype === "event") {
        await handleSystemEvent(msg as KfMessage, effectiveAccountConfig);
      }
      break;

    case 5:
      // Phase 4 (P4-01)：接待人员消息不触发 Bot/Agent 抢答，仅记录审计
      console.log("[wecom_kf] origin=5 servicer message skipped");
      break;

    default:
      if (msgtype === "event") {
        await handleSystemEvent(msg as KfMessage, effectiveAccountConfig);
      } else {
        console.log(`[wecom_kf] Unknown origin: ${origin ?? "undefined"}`);
      }
    }
    if (msgId) await commitWecomKfInboundMsgid(openKfId, msgId);
  } catch (error) {
    if (msgId) await releaseWecomKfInboundMsgid(openKfId, msgId, error);
    throw error;
  }
}
