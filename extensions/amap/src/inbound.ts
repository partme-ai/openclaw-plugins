/**
 * 高德 Webhook 入站处理：POST /channels/amap/webhook
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { AmapAccountConfig } from "./types.js";

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * 创建高德 Webhook 处理器
 */
export function createAmapWebhookHandler(
  getConfig: () => AmapAccountConfig | undefined,
  onInbound: (params: { shopId: string; sessionId: string; content: string }) => void,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      const body = await readBody(req);
      const config = getConfig();
      const poiId = config?.poi_id ?? "default";
      const sessionId = `amap:${poiId}`;
      onInbound({ shopId: poiId, sessionId, content: body || "{}" });
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("success");
    } catch (e) {
      console.error("[amap] webhook error:", e);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
    }
  };
}
