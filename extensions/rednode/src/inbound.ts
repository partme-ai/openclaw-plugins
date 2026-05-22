/**
 * 小红书 Webhook 入站：POST /channels/xhs/webhook
 */

import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  readRequestBodyWithLimit,
  isRequestBodyLimitError,
  DEFAULT_WEBHOOK_MAX_BODY_BYTES,
} from "./runtime-api.js";
import { dispatchWebhookInbound } from "./dispatch-inbound.js";
import type { PluginApi, XhsAccountConfig } from "./types.js";

/**
 * 小红书 Webhook 验签
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

function getSignatureFromRequest(req: IncomingMessage): string | undefined {
  const raw = req.headers["x-xhs-signature"] ?? req.headers["x-signature"];
  return Array.isArray(raw) ? raw[0] : raw;
}

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
 * 创建小红书 Webhook 处理器
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
