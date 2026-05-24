/**
 * @fileoverview Rednode Webhook 入站 Adapter：验签、限流读取与 dispatch 编排。
 *
 * @description
 * 接收小红书平台 Webhook POST：HMAC 验签 → 解析 shopId/messageId →
 * 委托 `dispatchWebhookInbound` 进入 Agent 管线。
 *
 * @module inbound
 */

/**
 * Rednode Webhook 入站 — Base Profile 入口。
 */

import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  readRequestBodyWithLimit,
  isRequestBodyLimitError,
  DEFAULT_WEBHOOK_MAX_BODY_BYTES,
} from "./runtime/runtime-api.js";
import { dispatchWebhookInbound } from "./dispatch/dispatch-inbound.js";
import type { PluginApi, XhsAccountConfig } from "./types.js";

/**
 * @description 小红书 Webhook HMAC-SHA256 验签。
 * @param body - 原始请求体字符串。
 * @param signatureHeader - 请求头中的签名（hex）。
 * @param config - 账号配置（webhook_secret 或 app_secret）。
 * @returns 验签是否通过。
 * @throws 不抛出。
 */
export function verifyXhsWebhook(
  body: string,
  signatureHeader: string | undefined,
  config: XhsAccountConfig,
): boolean {
  const secret = config.webhook_secret ?? config.app_secret;
  if (!secret || !signatureHeader?.trim()) return false;
  const expected = crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
  const got = signatureHeader.trim();
  if (got.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

/**
 * @description 从请求头读取小红书签名（x-xhs-signature / x-signature）。
 * @param req - HTTP 入站请求。
 * @returns 签名字符串或 `undefined`。
 * @throws 不抛出。
 */
function getSignatureFromRequest(req: IncomingMessage): string | undefined {
  const raw = req.headers["x-xhs-signature"] ?? req.headers["x-signature"];
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * @description 从 Webhook JSON body 或配置提取 shopId。
 * @param body - 原始请求体。
 * @param config - 账号配置（shop_id / seller_id 回退）。
 * @returns 店铺/卖家标识。
 * @throws 不抛出。
 */
function extractShopId(body: string, config: XhsAccountConfig): string {
  try {
    const raw = JSON.parse(body) as Record<string, unknown>;
    const sid = raw.shop_id ?? raw.shopId ?? raw.seller_id ?? raw.sellerId;
    if (typeof sid === "string" && sid.trim()) return sid.trim();
    if (typeof sid === "number") return String(sid);
  } catch {
    // 非 JSON 时使用配置默认值
  }
  return config.shop_id ?? config.seller_id ?? "default";
}

/**
 * @description 从请求头或 body 提取 Webhook 幂等 messageId。
 * @param req - HTTP 入站请求。
 * @param body - 原始请求体。
 * @returns messageId 或 `undefined`。
 * @throws 不抛出。
 */
function extractWebhookMessageId(req: IncomingMessage, body: string): string | undefined {
  const header = req.headers["msg-id"] ?? req.headers["x-msg-id"];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (typeof fromHeader === "string" && fromHeader.trim()) {
    return fromHeader.trim();
  }
  try {
    const raw = JSON.parse(body) as Record<string, unknown>;
    const id = raw.msg_id ?? raw.message_id ?? raw.event_id ?? raw.id;
    if (id != null && id !== "") return String(id);
  } catch {
    // ignore
  }
  return undefined;
}

/**
 * @description 创建小红书 Webhook HTTP 处理器（验签 → dispatch → 200/403/413/500）。
 * @param getConfig - 读取当前 xhs 账号配置。
 * @param api - 插件 API（含 runtime）。
 * @returns Express 风格 async handler。
 * @throws handler 内部 catch 后写 500，不向外抛。
 */
export function createXhsWebhookHandler(
  getConfig: () => XhsAccountConfig | undefined,
  api: PluginApi,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      const body = await readRequestBodyWithLimit(req, {
        maxBytes: DEFAULT_WEBHOOK_MAX_BODY_BYTES,
      });
      const config = getConfig();
      if (!config?.app_secret && !config?.webhook_secret) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Forbidden: xhs channel not configured");
        return;
      }
      const signature = getSignatureFromRequest(req);
      if (!verifyXhsWebhook(body, signature, config!)) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Forbidden: invalid signature");
        return;
      }
      const shopId = extractShopId(body, config!);
      const messageId = extractWebhookMessageId(req, body);
      const result = await dispatchWebhookInbound({
        api,
        channel: "xhs",
        accountId: "default",
        peerId: shopId,
        shopId,
        rawBody: body,
        messageId,
      });
      if (result === "skipped") {
        console.warn("[rednode] inbound skipped: no dispatch runtime available");
      }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("success");
    } catch (e) {
      if (isRequestBodyLimitError(e)) {
        res.writeHead(413, { "Content-Type": "text/plain" });
        res.end("payload too large");
        return;
      }
      console.error("[rednode] webhook error:", e);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
    }
  };
}
