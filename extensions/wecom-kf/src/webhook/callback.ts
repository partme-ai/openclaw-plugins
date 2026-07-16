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

/** Account state tracking — updates via channel setStatus */
const accountStatePatches = new Map<string, Record<string, unknown>>();
const accountSyncQueues = new Map<string, Promise<void>>();
const MAX_SYNC_PAGES = 100;
const DEFAULT_CALLBACK_MAX_TIMESTAMP_SKEW_SECONDS = 300;

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

function enqueueAccountSync(key: string, task: () => Promise<void>): void {
  const previous = accountSyncQueues.get(key) ?? Promise.resolve();
  const next = previous.then(task, task);
  accountSyncQueues.set(key, next);
  void next
    .catch((error: unknown) => {
      console.error(`[wecom_kf] background sync failed: ${error instanceof Error ? error.message : String(error)}`);
    })
    .finally(() => {
      if (accountSyncQueues.get(key) === next) accountSyncQueues.delete(key);
    });
}

/**
 * 创建回调处理函数
 */
export function createKfCallbackHandler(
  getAccountConfig: (openKfId?: string) => WecomAccountConfig | undefined,
  options: {
    nowSeconds?: () => number;
    maxTimestampSkewSeconds?: number;
  } = {},
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
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
        const queueKey = (eventData.OpenKfId as string | undefined)?.trim() || "default";
        enqueueAccountSync(queueKey, () => processKfEvent(eventData, getAccountConfig));
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
      console.warn(`[wecom_kf] rejected callback: ${error instanceof Error ? error.message : String(error)}`);
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
  getAccountConfig: (openKfId?: string) => WecomAccountConfig | undefined,
): Promise<void> {
  const callbackToken = eventData.Token as string | undefined;
  const openKfId = (eventData.OpenKfId as string | undefined)?.trim();

  const accountConfig = getAccountConfig(openKfId) ?? getAccountConfig();
  if (!accountConfig) {
    console.error(`[wecom_kf] No config found for ${openKfId ? "callback account" : "default account"}`);
    return;
  }

  const effectiveOpenKfId = openKfId || accountConfig.openKfId?.trim() || "";
  if (!effectiveOpenKfId) {
    console.warn("[wecom_kf] cannot pull messages without open_kfid");
    return;
  }

  let runtime;
  let cfg: OpenClawConfig;
  try {
    runtime = getWecomRuntime();
    cfg = runtime.config.current() as OpenClawConfig;
  } catch {
    console.error("[wecom_kf] Runtime not available for sync_msg");
    return;
  }

  const agent = resolveKfAgentAccount(cfg, effectiveOpenKfId);
  if (!agent) {
    console.warn(
      "[wecom_kf] cannot pull messages before corpSecret is configured; finish callback verification, then configure corpSecret",
    );
    return;
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
      console.error(
        `[wecom_kf] sync_msg failed: ${syncResult.errmsg} (errcode: ${syncResult.errcode})`,
      );
      break;
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
