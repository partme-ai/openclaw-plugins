/**
 * 高德 Webhook 入站处理（Inbound Adapter）
 *
 * **架构角色**：HTTP 传输层与消息派发层之间的适配器，负责：
 * - 读取并限流 Webhook 请求体
 * - 提取消息幂等键（msg-id / body 内 id 字段）
 * - 调用 `dispatchWebhookInbound` 写入 Agent 管线
 *
 * **关键依赖**：
 * - `./runtime/runtime-api` — 请求体读取与体积限制
 * - `./dispatch/dispatch-inbound` — 入站消息解析与派发
 * - `./types` — 账号配置与 PluginApi 类型
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  readRequestBodyWithLimit,
  isRequestBodyLimitError,
  DEFAULT_WEBHOOK_MAX_BODY_BYTES,
} from "./runtime/runtime-api.js";
import { dispatchWebhookInbound } from "./dispatch/dispatch-inbound.js";
import type { AmapAccountConfig, PluginApi } from "./types.js";

/**
 * 从 HTTP 头或 JSON body 中提取 Webhook 消息 ID，用于入站幂等去重。
 *
 * 优先顺序：`msg-id` / `x-msg-id` 头 → body 内 `msg_id` / `message_id` / `event_id` / `id`。
 *
 * @param req - Node HTTP 入站请求
 * @param body - 已读取的原始请求体字符串
 * @returns 消息 ID；无法解析时返回 `undefined`
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
    // body 非 JSON 时跳过解析
  }
  return undefined;
}

/**
 * 创建高德 Webhook HTTP 处理器。
 *
 * 成功时固定返回 `200` + `"success"`；超限返回 `413`；其它异常返回 `500`。
 *
 * @param getConfig - 读取当前高德账号配置的 getter
 * @param api - OpenClaw 插件 API（含 runtime 与 channel 派发能力）
 * @returns 可注册到 Gateway 的 async HTTP handler
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
