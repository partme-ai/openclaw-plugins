/**
 * 高德 Webhook 入站处理：POST /channels/amap/webhook
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  readRequestBodyWithLimit,
  isRequestBodyLimitError,
  DEFAULT_WEBHOOK_MAX_BODY_BYTES,
} from "./runtime/runtime-api.js";
import { dispatchWebhookInbound } from "./dispatch/dispatch-inbound.js";
import type { AmapAccountConfig, PluginApi } from "./types.js";

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
 * 创建高德 Webhook 处理器
 */
export function createAmapWebhookHandler(
  getConfig: () => AmapAccountConfig | undefined,
  api: PluginApi,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      const body = await readRequestBodyWithLimit(req, {
        maxBytes: DEFAULT_WEBHOOK_MAX_BODY_BYTES,
      });
      const config = getConfig();
      const poiId = config?.poi_id ?? "default";
      const messageId = extractWebhookMessageId(req, body);
      const result = await dispatchWebhookInbound({
        api,
        channel: "amap",
        accountId: "default",
        peerId: poiId,
        shopId: poiId,
        rawBody: body || "{}",
        messageId,
      });
      if (result === "skipped") {
        console.warn("[amap] inbound skipped: no dispatch runtime available");
      }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("success");
    } catch (e) {
      if (isRequestBodyLimitError(e)) {
        res.writeHead(413, { "Content-Type": "text/plain" });
        res.end("payload too large");
        return;
      }
      console.error("[amap] webhook error:", e);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
    }
  };
}
