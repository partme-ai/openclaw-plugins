/**
 * Webhook 入站消息派发（Dispatch Layer）
 *
 * **架构角色**：将 Webhook 原始 body 经 message-sdk 解析后，
 * 优先走 Bridge reply-pipeline 驱动 Agent；不可用时回退 `publishInbound`。
 *
 * **关键依赖**：
 * - `../runtime/runtime-api` — 幂等、wire 解析、Channel 派发
 * - `../types` — `PluginApi`
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

/** 模块级幂等缓存：60s TTL，最多 1 万条，防止 Webhook 重复投递。 */
const idempotencyCache: IdempotencyCache = createIdempotencyCache({
  ttlMs: 60_000,
  maxEntries: 10_000,
});

/** Webhook 入站派发输入参数。 */
export type WebhookDispatchParams = {
  api: PluginApi;
  /** 渠道标识，如 `"amap"` */
  channel: string;
  accountId: string;
  /** 对端 ID，通常为 poi_id */
  peerId: string;
  shopId: string;
  /** 原始 HTTP body 字符串 */
  rawBody: string;
  /** 可选消息 ID，用于幂等去重 */
  messageId?: string;
};

/**
 * Webhook 派发结果。
 *
 * - `dispatched` — 已成功写入 Agent 管线或 publishInbound
 * - `duplicate` — 幂等键命中，跳过重复消息
 * - `skipped` — 无可用 runtime（既无 bridge 也无 publishInbound）
 */
export type WebhookDispatchResult = "dispatched" | "duplicate" | "skipped";

/**
 * 检测 runtime 是否具备 Bridge reply-pipeline 能力。
 *
 * 需同时存在 `channel.reply.dispatchReplyFromConfig` 与 `channel.routing.resolveAgentRoute`。
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
 * 解析 Webhook body 并派发至 Agent 管线。
 *
 * @param params - Webhook 上下文与原始 body
 * @returns 派发结果：`dispatched` | `duplicate` | `skipped`
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

  // Bridge 不可用时回退轻量 publishInbound
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
