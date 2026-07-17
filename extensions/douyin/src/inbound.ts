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

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * 构建符合 `registerPluginHttpRoute` 签名的 HTTP 处理器。
 */
export function createDouyinPluginHttpHandler(params: {
  account: ResolvedDouyinAccount;
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
      const runtime = getDouyinRuntime();
      // `runtime.config` 是宿主提供的配置服务，不是可直接传给路由器的
      // `openclaw.json` 快照。必须在收到事件时调用 loadConfig()，这样既能拿到
      // 当前热更新后的 bindings/session/channel 配置，也不会把服务方法误当配置字段。
      const cfg = runtime.config.loadConfig() as Record<string, unknown>;
      const peerId =
        extractDouyinSenderId(body) ?? `anonymous:${account.shop_id ?? account.accountId}`;

      const dispatch = dispatchDouyinWebhookInbound({
        runtime,
        cfg,
        account,
        rawBody: body,
        text: extractDouyinWebhookText(body),
        peerId,
        messageId: msgIdHeader,
        log,
      });

      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("success");
      void dispatch.then((result) => {
        if (result === "skipped") {
          log?.warn?.("[douyin] inbound skipped: no transcript runtime available");
        } else if (result === "blocked") {
          log?.warn?.(`[douyin] inbound blocked by account ${account.accountId} access policy`);
        }
      }).catch((error: unknown) => {
        log?.error?.(`[douyin] webhook dispatch failed: ${String(error)}`);
      });
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
