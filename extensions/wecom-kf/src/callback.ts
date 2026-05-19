/**
 * HTTP 回调处理器
 * 接收企微 kf_msg_or_event 回调通知（文档 97712、94670），端点：/wecom/kefu
 *
 * 流程：验签解密 → sync_msg 拉取 → 按 origin 分发（客户消息 / 系统事件）
 * 与 wecom 插件 webhook 入口职责对齐
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { KfMessage, WecomAccountConfig } from "./types/index.js";
import { parseWecomCallback } from "./crypto.js";
import { getAccessToken, syncMessages } from "./agent/api-client.js";
import { getCursorStore } from "./cursor-store.js";
import { handleCustomerMessage } from "./agent/handler.js";
import { handleSystemEvent } from "./agent/system-event.js";

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
        defaultConfig.token,
        defaultConfig.encodingAESKey
      );

      if (parsed.type === "verify") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(parsed.echostr);
        return;
      }

      const eventData = parsed.data;
      if (eventData.Event === "kf_msg_or_event") {
        processKfEvent(eventData, getAccountConfig).catch((error) => {
          console.error("[wecom_kf] Error processing KF event:", error);
        });
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

  const accessToken = await getAccessToken(
    accountConfig.corpId,
    accountConfig.corpSecret
  );

  const cursorStore = getCursorStore();
  const kfId = openKfId ?? accountConfig.openKfId;
  let cursor = await cursorStore.getCursor(kfId);

  let hasMore = true;
  while (hasMore) {
    const syncResult = await syncMessages(accessToken, cursor, token, openKfId);

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
  msg: KfMessage,
  accountConfig: WecomAccountConfig
): Promise<void> {
  switch (msg.origin) {
    case 3:
      await handleCustomerMessage(msg, accountConfig);
      break;

    case 4:
      if (msg.msgtype === "event") {
        await handleSystemEvent(msg, accountConfig);
      }
      break;

    case 5:
      break;

    default:
      console.log(`[wecom_kf] Unknown origin: ${msg.origin}`);
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
