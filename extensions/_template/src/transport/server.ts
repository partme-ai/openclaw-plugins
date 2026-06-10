/**
 * 传输层：HTTP Webhook / 长连接等服务端入口。
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { parseInboundMessage } from "../inbound.js";

/**
 * Webhook HTTP 处理器；返回 true 表示已处理该请求。
 */
export async function handleWebhookRequest(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const parsed = parseInboundMessage(undefined);
  if (!parsed) {
    return false;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
  return true;
}
