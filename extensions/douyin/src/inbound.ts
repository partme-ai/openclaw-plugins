/**
 * 抖音 Webhook 入站 HTTP 处理器。
 *
 * **架构角色**：Gateway `registerPluginHttpRoute` 的 handler 工厂，负责
 * 挑战应答、SHA1 验签、幂等去重，并经 message-sdk 派发至 Agent reply-pipeline。
 *
 * **关键依赖**：`./runtime`、`./runtime/runtime-api`、`./webhook/webhook-utils`
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

/** Gateway 注入的可选日志接口 */
export type DouyinGatewayLog = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
  debug?: (message: string) => void;
};

/** 抖音 Webhook 入站幂等缓存（按 msg-id 去重，TTL 60s） */
const idempotencyCache = createIdempotencyCache({ ttlMs: 60_000, maxEntries: 5000 });

/**
 * 构建符合 `registerPluginHttpRoute` 签名的 HTTP 处理器。
 *
 * **处理分支**（按顺序）：
 * 1. 非 GET/POST → 405
 * 2. `verify_webhook` 挑战 → 200 + challenge 明文
 * 3. 验签失败 → 401
 * 4. 幂等重复 → 200 success（静默丢弃）
 * 5. 正常入站 → dispatchChannelMessage → 200 success
 *
 * @param params.account 已解析账号（含 app_secret、webhook_path、shop_id）
 * @param params.log 可选 Gateway 日志
 * @returns 异步 handler；返回 `true` 表示请求已被完全处理并写回响应
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
      // 开放平台配置 Webhook 时的 URL 验证握手
      if (challenge != null) {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(challenge);
        return true;
      }

      const signature = req.headers["x-douyin-signature"] as string | undefined;
      const secret = account.app_secret ?? "";
      // SHA1(app_secret + rawBody) 与 X-Douyin-Signature 比对
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
      // 重复 msg-id 直接 ACK，避免平台重试风暴
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

      // reply-pipeline：入站文本进入 Agent，出站 deliver 当前为占位（无对称 DM 通道）
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
