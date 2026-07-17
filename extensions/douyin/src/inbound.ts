/**
 * 抖音 Webhook 入站 HTTP 处理器。
 *
 * **架构角色**：Gateway `registerPluginHttpRoute` 的 handler 工厂，负责
 * 挑战应答、SHA1 验签、幂等去重，并经 message-sdk Transcript 派发至 Agent。
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ResolvedDouyinAccount } from "./types.js";
import {
  readRequestBodyWithLimit,
  isRequestBodyLimitError,
  DEFAULT_WEBHOOK_MAX_BODY_BYTES,
} from "./runtime/runtime-api.js";
import type { DouyinWebhookInboxItem } from "./dispatch/webhook-inbox.js";
import {
  extractDouyinSenderId,
  extractDouyinWebhookText,
  parseDouyinWebhookEnvelope,
  tryParseVerifyWebhookChallenge,
  verifyDouyinSignature,
} from "./webhook/webhook-utils.js";

/** Gateway 注入的可选日志接口 */
export type DouyinGatewayLog = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
  debug?: (message: string) => void;
};

/** HTTP 层只依赖“持久接管”能力；后台如何派发与重试由账号级 Inbox 管理。 */
export type DouyinWebhookInboxWriter = {
  enqueue: (
    item: Omit<DouyinWebhookInboxItem, "attempts" | "createdAt" | "nextAttemptAt">,
  ) => Promise<"enqueued" | "duplicate">;
};

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * 构建符合 `registerPluginHttpRoute` 签名的 HTTP 处理器。
 */
export function createDouyinPluginHttpHandler(params: {
  account: ResolvedDouyinAccount;
  inbox: DouyinWebhookInboxWriter;
  log?: DouyinGatewayLog;
}): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const { account, log } = params;

  return async (req, res): Promise<boolean> => {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("method not allowed");
      return true;
    }

    try {
      const body = await readRequestBodyWithLimit(req, {
        maxBytes: DEFAULT_WEBHOOK_MAX_BODY_BYTES,
      });

      const signature = firstHeader(req.headers["x-douyin-signature"]);
      const secret = account.app_secret ?? "";
      if (!verifyDouyinSignature(secret, body, signature)) {
        res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("signature mismatch");
        return true;
      }

      const envelope = parseDouyinWebhookEnvelope(body);
      if (!envelope) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("invalid json");
        return true;
      }
      if (envelope.client_key && envelope.client_key !== account.app_key) {
        res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("client_key mismatch");
        return true;
      }

      const challenge = tryParseVerifyWebhookChallenge(body);
      if (challenge != null) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ challenge: /^-?\d+$/.test(challenge) ? Number(challenge) : challenge }));
        return true;
      }

      const msgIdHeader = firstHeader(req.headers["msg-id"]);
      if (!msgIdHeader?.trim()) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("missing Msg-Id");
        return true;
      }
      const peerId =
        extractDouyinSenderId(body) ?? `anonymous:${account.shop_id ?? account.accountId}`;

      // 只有原子落盘成功后才向平台确认。此处不等待 Agent；Gateway 崩溃后由 Inbox 重启恢复。
      const accepted = await params.inbox.enqueue({
        messageId: msgIdHeader.trim(),
        rawBody: body,
        text: extractDouyinWebhookText(body),
        peerId,
      });

      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("success");
      log?.debug?.(`[douyin] webhook inbox ${accepted}: account=${account.accountId}`);
      return true;
    } catch (e) {
      if (isRequestBodyLimitError(e)) {
        res.writeHead(413, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("payload too large");
        return true;
      }
      log?.error?.(`[douyin] webhook: ${String(e)}`);
      // 验签后但持久接管失败必须返回 503，明确要求平台稍后重投，不能误报已接收。
      res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("temporarily unavailable");
      return true;
    }
  };
}
