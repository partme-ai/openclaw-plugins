/**
 * 美团 Webhook 入站：POST /channels/meituan/webhook — 验签与事件解析。
 */

import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { MeituanAccountConfig, PluginLogger } from "./types.js";

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * 美团 Webhook 验签
 */
export function verifyMeituanWebhook(
  body: string,
  signatureHeader: string | undefined,
  config: MeituanAccountConfig,
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
  const raw = req.headers["x-meituan-signature"] ?? req.headers["x-signature"];
  return Array.isArray(raw) ? raw[0] : raw;
}

function parseMeituanEventBody(body: string): { shop_id?: string; content: string } {
  let eventType = "unknown";
  let shopId: string | undefined;
  try {
    const raw = JSON.parse(body) as Record<string, unknown>;
    eventType =
      (raw.event_type as string) ??
      (raw.type as string) ??
      (raw.msg_type as string) ??
      eventType;
    const sid = raw.shop_id ?? raw.shopId;
    shopId = typeof sid === "string" ? sid : typeof sid === "number" ? String(sid) : undefined;
    const content = JSON.stringify({ event_type: eventType, ...raw });
    return { shop_id: shopId, content };
  } catch {
    return { content: body };
  }
}

/**
 * 创建美团 Webhook 处理器
 */
export function createMeituanWebhookHandler(
  getConfig: () => MeituanAccountConfig | undefined,
  onInbound: (params: { shopId: string; sessionId: string; content: string }) => void,
  logger?: PluginLogger,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const logError = (msg: string, ...args: unknown[]) => {
    if (typeof logger?.error === "function") logger.error(msg, ...args);
    else console.error(msg, ...args);
  };
  return async (req, res) => {
    try {
      const body = await readBody(req);
      const config = getConfig();
      if (!config?.app_secret && !config?.webhook_secret) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Forbidden: meituan channel not configured");
        return;
      }
      const signature = getSignatureFromRequest(req);
      if (!verifyMeituanWebhook(body, signature, config!)) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Forbidden: invalid signature");
        return;
      }
      const parsed = parseMeituanEventBody(body);
      const shopId = parsed.shop_id ?? config!.shop_id ?? "default";
      const sessionId = `meituan:${shopId}`;
      onInbound({ shopId, sessionId, content: parsed.content });
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("success");
    } catch (e) {
      logError("[meituan] webhook error:", e);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
    }
  };
}
