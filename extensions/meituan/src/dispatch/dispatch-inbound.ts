/**
 * Webhook 入站派发模块（message-sdk bridge + publishInbound 回退）。
 *
 * **架构角色**：inbound handler 与 Agent 管线之间的适配层，负责 wire 解析、
 * 幂等去重、路由 identity 解析，以及 reply-pipeline / publishInbound 双路径派发。
 *
 * **关键依赖**：`../runtime/runtime-api`、`../types`
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

/** 模块级幂等缓存（msg-id，TTL 60s） */
const idempotencyCache: IdempotencyCache = createIdempotencyCache({
  ttlMs: 60_000,
  maxEntries: 10_000,
});

/** dispatchWebhookInbound 入参 */
export type WebhookDispatchParams = {
  /** 插件 API（含 runtime） */
  api: PluginApi;
  /** 渠道 id，如 meituan */
  channel: string;
  /** 账号 id */
  accountId: string;
  /** 对端 id（通常为 shopId） */
  peerId: string;
  /** 门店 id，写入 session 与 extra */
  shopId: string;
  /** Webhook 原始 body */
  rawBody: string;
  /** 可选消息 id，用于幂等 */
  messageId?: string;
};

/** 派发结果：已派发 / 重复丢弃 / 无可用 runtime 跳过 */
export type WebhookDispatchResult = "dispatched" | "duplicate" | "skipped";

/**
 * 探测 runtime 是否具备 message-sdk bridge 能力（reply + routing）。
 *
 * @param runtime 宿主注入的 runtime 对象
 * @returns 满足 bridge 契约时返回 BridgePluginRuntime，否则 null
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
 * **派发分支**：
 * 1. 幂等重复 → `duplicate`
 * 2. bridge runtime 可用 → `reply-pipeline` → `dispatched`
 * 3. 仅 publishInbound 可用 → 轻量写入 → `dispatched`
 * 4. 均不可用 → `skipped`
 *
 * @param params Webhook 上下文与原始 payload
 * @returns 派发结果枚举
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
  // 优先走完整 reply-pipeline（与 OpenClaw channel bridge 对齐）
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

  // 回退：宿主仅注入 publishInbound 时直接写入 Session
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
