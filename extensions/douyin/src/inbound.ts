/**
 * 抖音 Webhook 入站 HTTP 处理器。
 *
 * **架构角色**：Gateway `registerPluginHttpRoute` 的 handler 工厂，负责
 * 挑战应答、SHA1 验签、幂等去重，并经 message-sdk Transcript 派发至 Agent。
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { getDouyinRuntime } from "./runtime.js";
import type { ResolvedDouyinAccount } from "./types.js";
import {
  readRequestBodyWithLimit,
  isRequestBodyLimitError,
  DEFAULT_WEBHOOK_MAX_BODY_BYTES,
} from "./runtime/runtime-api.js";
import { dispatchDouyinWebhookInbound } from "./dispatch/dispatch-inbound.js";
import {
  extractDouyinSenderId,
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

/**
 * 构建符合 `registerPluginHttpRoute` 签名的 HTTP 处理器。
 */
export function createDouyinPluginHttpHandler(params: {
  account: ResolvedDouyinAccount;
  log?: DouyinGatewayLog;
}): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const { account, log } = params;

  return async (req, res): Promise<boolean> => {
    if (req.method !== "POST" && req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("method not allowed");
      return true;
    }

    try {
      const body = await readRequestBodyWithLimit(req, {
        maxBytes: DEFAULT_WEBHOOK_MAX_BODY_BYTES,
      });

      const challenge = tryParseVerifyWebhookChallenge(body);
      if (challenge != null) {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(challenge);
        return true;
      }

      const signature = req.headers["x-douyin-signature"] as string | undefined;
      const secret = account.app_secret ?? "";
      if (!verifyDouyinSignature(secret, body, signature)) {
        res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("signature mismatch");
        return true;
      }

      const msgIdHeader = req.headers["msg-id"] as string | undefined;
      const messageId = msgIdHeader ?? `douyin-${Date.now()}`;
      const runtime = getDouyinRuntime();
      const cfg = (runtime.config ?? {}) as Record<string, unknown>;
      const peerId =
        extractDouyinSenderId(body) ?? `anonymous:${account.shop_id ?? account.accountId}`;

      const result = await dispatchDouyinWebhookInbound({
        runtime,
        cfg,
        account,
        rawBody: body,
        text: body,
        peerId,
        messageId: msgIdHeader ?? messageId,
        log,
      });

      if (result === "skipped") {
        log?.warn?.("[douyin] inbound skipped: no transcript runtime available");
      }

      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("success");
      return true;
    } catch (e) {
      if (isRequestBodyLimitError(e)) {
        res.writeHead(413, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("payload too large");
        return true;
      }
      log?.error?.(`[douyin] webhook: ${String(e)}`);
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("error");
      return true;
    }
  };
}
