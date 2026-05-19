/**
 * 高德 Webhook 回调：POST /channels/amap/webhook
 * 高德当前无统一事件推送，仅将 body 作为入站内容（可选）；若需验签可后续按平台文档补充。
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
 * 当前高德无官方事件推送，仅读取 body 并调用 onInbound（便于测试或人工触发）；后续若平台提供验签则在此补充。
 */
export function createAmapWebhookHandler(
  getConfig: () => AmapAccountConfig | undefined,
  onInbound: (params: { shopId: string; sessionId: string; content: string }) => void
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
