/**
 * @fileoverview Rednode Webhook 入站 dispatch：message-sdk 解析与 Agent 管线派发。
 *
 * @description
 * 支持 reply-pipeline（BridgePluginRuntime）与 `publishInbound` 回退双路径；
 * 内置 TTL 幂等缓存防止 Webhook 重试重复入站。
 *
 * @module dispatch/dispatch-inbound
 */

/**
 * Rednode Webhook dispatch — Base Profile 入口。
 */

import {
  createIdempotencyCache,
  normalizeWireIngress,
  dispatchChannelMessage,
  resolveChannelDispatchIdentity,
  type BridgePluginRuntime,
  type IdempotencyCache,
} from "../runtime/runtime-api.js";
import type { PluginApi } from "../types.js";

const idempotencyCache: IdempotencyCache = createIdempotencyCache({
  ttlMs: 60_000,
  maxEntries: 10_000,
});

/** @description Webhook 派发入参。 */
export type WebhookDispatchParams = {
  api: PluginApi;
  channel: string;
  accountId: string;
  peerId: string;
  shopId: string;
  rawBody: string;
  messageId?: string;
};

/** @description Webhook 派发结果：已分发 / 重复 / 跳过。 */
export type WebhookDispatchResult = "dispatched" | "duplicate" | "skipped";

/**
 * @description 检测 runtime 是否具备 message-sdk Bridge 能力（reply + routing）。
 * @param runtime - 宿主 runtime 对象。
 * @returns 可 cast 为 BridgePluginRuntime 或 `null`。
 * @throws 不抛出。
 */
function getBridgeRuntime(runtime: unknown): BridgePluginRuntime | null {
  const rt = runtime as Record<string, unknown> | null | undefined;
  const channel = rt?.channel as Record<string, unknown> | undefined;
  const reply = channel?.reply as Record<string, unknown> | undefined;
  const routing = channel?.routing as Record<string, unknown> | undefined;
  if (
    typeof reply?.dispatchReplyFromConfig === "function" &&
    typeof routing?.resolveAgentRoute === "function"
  ) {
    return runtime as BridgePluginRuntime;
  }
  return null;
}

/**
 * @description 解析 Webhook body 并派发至 Agent 管线。
 * @param params - Webhook 上下文（api、channel、shopId、rawBody 等）。
 * @returns `dispatched` | `duplicate` | `skipped`。
 * @throws dispatch 失败时向上抛出。
 */
export async function dispatchWebhookInbound(
  params: WebhookDispatchParams,
): Promise<WebhookDispatchResult> {
  const parsed = normalizeWireIngress({
    rawPayload: params.rawBody,
    mode: "jsonTextOrPlain",
    channel: params.channel,
    idempotencyKey: params.messageId,
    idempotency: params.messageId ? idempotencyCache : undefined,
  });
  if (!parsed.accepted) {
    return "duplicate";
  }
  const text = parsed.text ?? params.rawBody;

  const bridgeRuntime = getBridgeRuntime(params.api.runtime);
  if (bridgeRuntime) {
    const { agentId, sessionKey } = await resolveChannelDispatchIdentity(bridgeRuntime, {
      channel: params.channel,
      accountId: params.accountId,
      peerId: params.peerId,
    });
    await dispatchChannelMessage({
      mode: "reply-pipeline",
      runtime: bridgeRuntime,
      channel: params.channel,
      accountId: params.accountId,
      peerId: params.peerId,
      text,
      agentId,
      sessionKey,
      unified: parsed.unified,
      extra: {
        shopId: params.shopId,
        sessionId: `${params.channel}:${params.shopId}`,
      },
      reply: {
        deliver: async () => {
          // 出站由 channel outbound adapter 处理
        },
        outboundFormat: "plainText",
      },
    });
    return "dispatched";
  }

  const publish = params.api.runtime?.channel?.publishInbound;
  if (typeof publish === "function") {
    await publish({
      channel: params.channel,
      sessionId: `${params.channel}:${params.shopId}`,
      shopId: params.shopId,
      content: text,
    });
    return "dispatched";
  }

  return "skipped";
}
