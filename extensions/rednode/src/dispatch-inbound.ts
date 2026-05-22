/**
 * Webhook 入站经 message-sdk 解析并派发（reply-pipeline 或 publishInbound 回退）。
 */

import {
  createIdempotencyCache,
  normalizeWireIngress,
  createChannelDispatch,
  resolveChannelDispatchIdentity,
  type BridgePluginRuntime,
  type IdempotencyCache,
} from "./runtime-api.js";
import type { PluginApi } from "./types.js";

const idempotencyCache: IdempotencyCache = createIdempotencyCache({
  ttlMs: 60_000,
  maxEntries: 10_000,
});

export type WebhookDispatchParams = {
  api: PluginApi;
  channel: string;
  accountId: string;
  peerId: string;
  shopId: string;
  rawBody: string;
  messageId?: string;
};

export type WebhookDispatchResult = "dispatched" | "duplicate" | "skipped";

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
 * 解析 Webhook body 并派发至 Agent 管线。
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
    await createChannelDispatch({
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
