/**
 * Gateway 注册的抖音 Webhook：验签、挑战应答，并通过 dispatchInboundDirectDmWithRuntime 入站。
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig } from "openclaw/plugin-sdk/account-resolution";
import { dispatchInboundDirectDmWithRuntime } from "openclaw/plugin-sdk/channel-inbound";
import { getDouyinRuntime } from "./runtime.js";
import type { ResolvedDouyinAccount } from "./types.js";
import {
  extractDouyinSenderId,
  isDuplicateMsgId,
  readWebhookBody,
  tryParseVerifyWebhookChallenge,
  verifyDouyinSignature,
} from "./webhook-utils.js";

export type DouyinGatewayLog = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
  debug?: (message: string) => void;
};

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
      const body = await readWebhookBody(req);

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
      if (isDuplicateMsgId(msgIdHeader)) {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("success");
        return true;
      }

      const runtime = getDouyinRuntime();
      const cfg = runtime.config.loadConfig() as OpenClawConfig;

      const peerId =
        extractDouyinSenderId(body) ?? `anonymous:${account.shop_id ?? account.accountId}`;
      const shopRef = account.shop_id ?? account.accountId;

      await dispatchInboundDirectDmWithRuntime({
        cfg,
        runtime,
        channel: "douyin",
        channelLabel: "抖音",
        accountId: account.accountId,
        peer: { kind: "direct", id: peerId },
        senderId: peerId,
        senderAddress: `douyin:${peerId}`,
        recipientAddress: `douyin:shop:${shopRef}`,
        conversationLabel: peerId,
        rawBody: body,
        messageId,
        deliver: async () => {
          log?.warn?.(
            "[douyin] 出站 DM 未接开放平台对称通道；请用抖店/OpenAPI 或 douyin-cli 发送回复。",
          );
        },
        onRecordError: (err: unknown) => {
          log?.error?.(`[douyin] record inbound: ${String(err)}`);
        },
        onDispatchError: (err: unknown, info: { kind: string }) => {
          log?.error?.(`[douyin] dispatch (${info.kind}): ${String(err)}`);
        },
      });

      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("success");
      return true;
    } catch (e) {
      log?.error?.(`[douyin] webhook: ${String(e)}`);
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("error");
      return true;
    }
  };
}
