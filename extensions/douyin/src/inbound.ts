/**
 * Gateway 注册的抖音 Webhook：验签、挑战应答，并经 message-sdk 入站派发。
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { getDouyinRuntime } from "./runtime.js";
import type { ResolvedDouyinAccount } from "./types.js";
import {
  createIdempotencyCache,
  readRequestBodyWithLimit,
  isRequestBodyLimitError,
  DEFAULT_WEBHOOK_MAX_BODY_BYTES,
  normalizeWireIngress,
  dispatchChannelMessage,
  resolveChannelDispatchIdentity,
  type BridgePluginRuntime,
} from "./runtime/runtime-api.js";
import {
  extractDouyinSenderId,
  tryParseVerifyWebhookChallenge,
  verifyDouyinSignature,
} from "./webhook/webhook-utils.js";

export type DouyinGatewayLog = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
  debug?: (message: string) => void;
};

/** 抖音 Webhook 入站幂等缓存（msg-id）。 */
const idempotencyCache = createIdempotencyCache({ ttlMs: 60_000, maxEntries: 5000 });

/**
 * 构建符合 registerPluginHttpRoute 的处理器：返回 true 表示已响应请求。
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

      const parsed = normalizeWireIngress({
        rawPayload: body,
        mode: "jsonTextOrPlain",
        channel: "douyin",
        idempotencyKey: msgIdHeader,
        idempotency: msgIdHeader ? idempotencyCache : undefined,
      });
      if (!parsed.accepted) {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("success");
        return true;
      }
      const text = parsed.text ?? body;
      const runtime = getDouyinRuntime();
      const peerId =
        extractDouyinSenderId(body) ?? `anonymous:${account.shop_id ?? account.accountId}`;
      const shopRef = account.shop_id ?? account.accountId;

      const { agentId, sessionKey } = await resolveChannelDispatchIdentity(
        runtime as unknown as BridgePluginRuntime,
        {
          channel: "douyin",
          accountId: account.accountId,
          peerId,
        },
      );

      await dispatchChannelMessage({
        mode: "reply-pipeline",
        runtime: runtime as unknown as BridgePluginRuntime,
        channel: "douyin",
        accountId: account.accountId,
        peerId,
        text,
        agentId,
        sessionKey,
        unified: parsed.unified,
        extra: {
          rawBody: body,
          messageId,
          shopId: shopRef,
        },
        reply: {
          deliver: async () => {
            log?.warn?.(
              "[douyin] 出站 DM 未接开放平台对称通道；请用抖店/OpenAPI 或 douyin-cli 发送回复。",
            );
          },
          outboundFormat: "plainText",
          replyRoute: { shopId: shopRef },
        },
      });

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
