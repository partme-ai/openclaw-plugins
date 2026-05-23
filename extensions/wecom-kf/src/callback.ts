/**
 * HTTP 回调处理器
 * 接收企微 kf_msg_or_event 回调通知（文档 97712、94670），端点：/wecom/kefu
 *
 * 流程：验签解密 → sync_msg 拉取 → 按 origin 分发（客户消息 / 系统事件）
 * 与 wecom 插件 webhook 入口职责对齐
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { WecomAccountConfig } from "./types/index.js";
import { parseWecomCallback } from "./crypto.js";
import { getAccessToken, syncMessages } from "./agent/api-client.js";
import { getCursorStore } from "./cursor-store.js";
import { handleCustomerMessage } from "./agent/handler.js";
import { handleSystemEvent } from "./agent/system-event.js";
import { getWecomRuntime } from "./runtime.js";

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

/**
 * **primeWecomKfCursor (冷启动游标预热)**
 *
 * 在通道启动时遍历历史消息将游标推进到最新位置，防止重放历史消息。
 * 仅在 corpId + corpSecret 均配置时执行（需要主动发送能力）。
 * 从 research/openclaw-china 回移植。
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
    return; // Cursor already exists, no need to prime
  }

  console.log(`[wecom_kf] Priming cursor for openKfId=${openKfId}`);

  try {
    const token = await getAccessToken({
      accountId: "kf-prime",
      enabled: true,
      configured: true,
      corpId,
      corpSecret,
      token: "",
      encodingAESKey: "",
      config: { corpId, corpSecret, token: "", encodingAESKey: "" },
    });

    let cursor = "";
    let hasMore = true;
    while (hasMore) {
      const result = await syncMessages(token, cursor, undefined, openKfId, 1000);
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

/** 同一批消息最大并发处理数 */
const MSG_PROCESS_CONCURRENCY = 8;

/**
 * 创建并发限制器：最多 concurrency 个 Promise 同时执行
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
 * 创建回调处理函数
 * 返回绑定了 getAccountConfig 的 HTTP handler
 *
 * @param getAccountConfig - 根据 open_kfid 获取账号配置的函数
 */
export function createKfCallbackHandler(
  getAccountConfig: (openKfId?: string) => WecomAccountConfig | undefined
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      const url = new URL(
        req.url ?? "/",
        `http://${req.headers.host ?? "localhost"}`
      );
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
        defaultConfig.encodingAESKey ?? ""
      );

      if (parsed.type === "verify") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(parsed.echostr);
        return;
      }

      const eventData = parsed.data as Record<string, unknown> | undefined;
      if (!eventData) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("success");
        return;
      }

      // kf_msg_or_event: 客户消息/系统事件回调 (path 94670)
      if (eventData.Event === "kf_msg_or_event") {
        processKfEvent(eventData, getAccountConfig).catch((error) => {
          console.error("[wecom_kf] Error processing KF event:", error);
        });
      }

      // kf_account_auth_change: 客服账号授权变更通知 (path 97712)
      if (eventData.Event === "kf_account_auth_change") {
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
 * 处理 kf_msg_or_event 事件
 * 使用 sync_msg 拉取消息，遵循 next_cursor + has_more 规范；同一批消息有限并发处理
 *
 * @param eventData - 解密后的回调事件数据（含 Token、OpenKfId）
 * @param getAccountConfig - 根据 openKfId 解析账号配置
 */
async function processKfEvent(
  eventData: Record<string, unknown>,
  getAccountConfig: (openKfId?: string) => WecomAccountConfig | undefined
): Promise<void> {
  const token = eventData.Token as string | undefined;
  const openKfId = eventData.OpenKfId as string | undefined;

  const accountConfig = getAccountConfig(openKfId) ?? getAccountConfig();
  if (!accountConfig) {
    console.error(`[wecom_kf] No config found for account: ${openKfId}`);
    return;
  }

  const corpid = accountConfig.corpId ?? "";
  const corpseret = accountConfig.corpSecret ?? "";
  const accessToken = await getAccessToken({
    accountId: "kf-callback",
    enabled: true,
    configured: true,
    corpId: corpid,
    corpSecret: corpseret,
    token: "",
    encodingAESKey: "",
    config: {
      corpId: corpid,
      corpSecret: corpseret,
      token: "",
      encodingAESKey: "",
    },
  });

  const cursorStore = getCursorStore();
  const kfId = openKfId ?? accountConfig.openKfId ?? "";
  let cursor: string | undefined = await cursorStore.getCursor(kfId);

  let hasMore = true;
  while (hasMore) {
    const syncResult = await syncMessages(
      accessToken,
      cursor ?? "",
      cursor ? undefined : token,  // Only pass token on first pull
      openKfId,
    );

    if (syncResult.errcode !== 0) {
      console.error(
        `[wecom_kf] sync_msg failed: ${syncResult.errmsg} (errcode: ${syncResult.errcode})`
      );
      break;
    }

    const limit = createLimit<void>(MSG_PROCESS_CONCURRENCY);
    await Promise.all(
      syncResult.msg_list.map((msg) => limit(() => processMessage(msg, accountConfig)))
    );

    // Track last sync time
    trackAccountEvent(accountConfig.openKfId ?? kfId, { lastSyncAt: Date.now() });

    if (syncResult.next_cursor) {
      cursor = syncResult.next_cursor;
      await cursorStore.saveCursor(kfId, cursor);
    }

    hasMore = syncResult.has_more === 1;
  }
}

/**
 * 处理单条消息，按 origin 分发到客户消息或系统事件处理
 *
 * @param msg - 企微客服消息
 * @param accountConfig - 当前客服账号配置
 */
async function processMessage(
  msg: Record<string, unknown>,
  accountConfig: WecomAccountConfig
): Promise<void> {
  const origin = msg.origin as number | undefined;
  const msgtype = msg.msgtype as string | undefined;

  switch (origin) {
    case 3:
      trackAccountEvent(accountConfig.openKfId ?? "default", { lastInboundAt: Date.now() });
      await handleCustomerMessage(msg, accountConfig);
      break;

    case 4:
      if (msgtype === "event") {
        await handleSystemEvent(msg as Record<string, unknown> as Parameters<typeof handleSystemEvent>[0], accountConfig);
      }
      break;

    case 5:
      break;

    default:
      console.log(`[wecom_kf] Unknown origin: ${origin}`);
  }
}

/**
 * 读取 HTTP 请求体（GET 返回 null）
 *
 * @param req - Node 原生 IncomingMessage
 * @returns 请求体 UTF-8 字符串，GET 或空体为 null
 */
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
