/**
 * HTTP 回调处理器
 * 接收企微 kf_msg_or_event 回调通知（文档 97712、94670），端点：/wecom/kefu
 *
 * 流程：验签解密 → 快速 200 → sync_msg(has_more) → dedup → origin 分发
 * 对齐 research/openclaw-china/extensions/wecom-kf/src/webhook.ts
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { WecomAccountConfig } from "../types/index.js";
import { parseWecomCallback } from "../crypto.js";
import { syncKfMessages } from "../agent/api-client.js";
import { getCursorStore } from "../cursor-store.js";
import { dispatchKfMessage } from "../dispatch.js";
import { handleSystemEvent } from "../agent/system-event.js";
import { resolveKfAccountByOpenKfId } from "../config/accounts.js";
import { claimWecomKfInboundMsgid } from "../dedup/kf-inbound-dedup.js";
import { resolveKfAgentAccount } from "../kf/call-context.js";
import { getWecomRuntime } from "../runtime.js";
import type { KfMessage } from "../types/index.js";

/** Account state tracking — updates via channel setStatus */
const accountStatePatches = new Map<string, Record<string, unknown>>();

export function consumeAccountStatePatch(accountId: string): Record<string, unknown> | undefined {
  const patch = accountStatePatches.get(accountId);
  accountStatePatches.delete(accountId);
  return patch;
}

function trackAccountEvent(accountId: string, patch: Record<string, unknown>): void {
  const existing = accountStatePatches.get(accountId) ?? {};
  accountStatePatches.set(accountId, { ...existing, ...patch });
}

function buildCursorKey(accountKey: string, openKfId: string): string {
  return `${accountKey}:${openKfId}`;
}

/**
 * **primeWecomKfCursor (冷启动游标预热)**
 *
 * 在通道启动时遍历历史消息将游标推进到最新位置，防止重放历史消息。
 */
export async function primeWecomKfCursor(params: {
  accountConfig: WecomAccountConfig;
}): Promise<void> {
  const { accountConfig } = params;
  const openKfId = accountConfig.openKfId?.trim();
  if (!openKfId) return;

  const cursorStore = getCursorStore();
  const cursorKey = buildCursorKey("default", openKfId);
  if (await cursorStore.getCursor(cursorKey)) {
    return;
  }

  const runtime = getWecomRuntime();
  const cfg = runtime.config as OpenClawConfig;
  const agent = resolveKfAgentAccount(cfg, openKfId);
  if (!agent) {
    console.warn(`[wecom_kf] Skip cursor prime: corpSecret not configured openKfId=${openKfId}`);
    return;
  }

  console.log(`[wecom_kf] Priming cursor for openKfId=${openKfId}`);

  try {
    let cursor = "";
    let hasMore = true;
    while (hasMore) {
      const result = await syncKfMessages(agent, {
        cursor,
        open_kfid: openKfId,
        limit: 1000,
      });
      if (result.next_cursor) {
        cursor = result.next_cursor;
        await cursorStore.saveCursor(cursorKey, cursor);
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
 * 创建回调处理函数
 */
export function createKfCallbackHandler(
  getAccountConfig: (openKfId?: string) => WecomAccountConfig | undefined,
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

      const body = await readRequestBody(req);
      const defaultConfig = getAccountConfig();
      if (!defaultConfig) {
        console.error("[wecom_kf] No default account config found");
        res.writeHead(500);
        res.end("No account config");
        return;
      }

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
        void processKfEvent(eventData, getAccountConfig).catch((error) => {
          console.error("[wecom_kf] Error processing KF event:", error);
        });
      }

      if (eventData?.Event === "kf_account_auth_change") {
        const authAdd = (eventData.AuthAddOpenKfId as string)?.trim();
        const authDel = (eventData.AuthDelOpenKfId as string)?.trim();
        if (authAdd) console.log(`[wecom_kf] KF account authorized: ${authAdd}`);
        if (authDel) console.log(`[wecom_kf] KF account deauthorized: ${authDel}`);
      }

      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("success");
    } catch (error) {
      console.error("[wecom_kf] Callback error:", error);
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("success");
    }
  };
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
    console.error(`[wecom_kf] No config found for account: ${openKfId ?? "default"}`);
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
    cfg = runtime.config as OpenClawConfig;
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

  while (hasMore) {
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

    if (syncResult.next_cursor) {
      cursor = syncResult.next_cursor;
      await cursorStore.saveCursor(cursorKey, cursor);
    }

    hasMore = syncResult.has_more === 1;
  }
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
    const claimed = await claimWecomKfInboundMsgid(openKfId, msgId);
    if (!claimed) {
      console.log(`[wecom_kf] duplicate msgid=${msgId} open_kfid=${openKfId}; skipped`);
      return;
    }
  }

  const effectiveAccountConfig = resolveMessageAccountConfig(msg, accountConfig, cfg);
  const origin = msg.origin;
  const msgtype = msg.msgtype;

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
      break;

    default:
      if (msgtype === "event") {
        await handleSystemEvent(msg as KfMessage, effectiveAccountConfig);
      } else {
        console.log(`[wecom_kf] Unknown origin: ${origin ?? "undefined"}`);
      }
  }
}

function readRequestBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (req.method === "GET") {
      resolve(null);
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf-8") || null);
    });
    req.on("error", reject);
  });
}
