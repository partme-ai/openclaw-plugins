/**
 * 美团 Webhook 入站 HTTP 处理器。
 *
 * **架构角色**：`registerHttpRoute` 的 handler 工厂；负责读 body、验签、
 * 提取 shopId/msgId，并委托 `dispatch/dispatch-inbound` 派发。
 *
 * **关键依赖**：`./runtime/runtime-api`、`./dispatch/dispatch-inbound`、`./types`
 */

import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  readRequestBodyWithLimit,
  isRequestBodyLimitError,
  DEFAULT_WEBHOOK_MAX_BODY_BYTES,
} from "./runtime/runtime-api.js";
import { dispatchWebhookInbound } from "./dispatch/dispatch-inbound.js";
import type { MeituanAccountConfig, PluginApi, PluginLogger } from "./types.js";

/**
 * 校验美团 Webhook HMAC-SHA256 签名。
 *
 * @param body 原始请求体
 * @param signatureHeader `X-Meituan-Signature` 或 `X-Signature`
 * @param config 渠道配置（优先 webhook_secret，回退 app_secret）
 * @returns 签名有效时为 true
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
  // 长度不一致时 timingSafeEqual 会抛错，先短路
  if (got.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

/** 从请求头读取签名（兼容 x-meituan-signature / x-signature） */
function getSignatureFromRequest(req: IncomingMessage): string | undefined {
  const raw = req.headers["x-meituan-signature"] ?? req.headers["x-signature"];
  return Array.isArray(raw) ? raw[0] : raw;
}

/** 从 Webhook JSON 或配置回退解析 shop_id，用作 peerId */
function extractShopId(body: string, config: MeituanAccountConfig): string {
  try {
    const raw = JSON.parse(body) as Record<string, unknown>;
    const sid = raw.shop_id ?? raw.shopId;
    if (typeof sid === "string" && sid.trim()) return sid.trim();
    if (typeof sid === "number") return String(sid);
  } catch {
    // ignore
  }
  return config.shop_id ?? "default";
}

/** 优先 msg-id 请求头，其次 body 内 msg_id / event_id 等字段 */
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
 * 创建美团 Webhook HTTP 处理器。
 *
 * **处理分支**：
 * 1. 未配置 secret → 403
 * 2. 验签失败 → 403
 * 3. dispatch 成功/跳过 → 200 success
 * 4. body 超限 → 413；其他异常 → 500
 *
 * @param getConfig 懒加载渠道配置
 * @param api 插件 API（含 runtime，供 dispatch 使用）
 * @param logger 可选结构化日志
 * @returns Express 风格 async handler
 */
export function createMeituanWebhookHandler(
  getConfig: () => MeituanAccountConfig | undefined,
  api: PluginApi,
  logger?: PluginLogger,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const logError = (msg: string, ...args: unknown[]) => {
    if (typeof logger?.error === "function") logger.error(msg, ...args);
    else console.error(msg, ...args);
  };
  const logWarn = (msg: string, ...args: unknown[]) => {
    if (typeof logger?.warn === "function") logger.warn(msg, ...args);
    else console.warn(msg, ...args);
  };
  return async (req, res) => {
    try {
      const body = await readRequestBodyWithLimit(req, {
        maxBytes: DEFAULT_WEBHOOK_MAX_BODY_BYTES,
      });
      const config = getConfig();
      // 未配置 app_secret / webhook_secret 时拒绝一切入站
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
      const shopId = extractShopId(body, config!);
      const messageId = extractWebhookMessageId(req, body);
      const result = await dispatchWebhookInbound({
        api,
        channel: "meituan",
        accountId: "default",
        peerId: shopId,
        shopId,
        rawBody: body,
        messageId,
      });
      // 运行时无 bridge 且无 publishInbound 时 dispatch 返回 skipped
      if (result === "skipped") {
        logWarn("[meituan] inbound skipped: no dispatch runtime available");
      }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("success");
    } catch (e) {
      if (isRequestBodyLimitError(e)) {
        res.writeHead(413, { "Content-Type": "text/plain" });
        res.end("payload too large");
        return;
      }
      logError("[meituan] webhook error:", e);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
    }
  };
}
