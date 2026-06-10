/**
 * Webhook 入站派发模块（message-sdk Transcript + publishInbound 回退）。
 *
 * **架构角色**：inbound handler 与 Agent 管线之间的适配层，负责 wire 解析、
 * 幂等去重、Transcript 派发（dispatchTranscriptTurn）与 publishInbound 回退。
 */

import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import {
  createIdempotencyCache,
  normalizeWireIngress,
  type IdempotencyCache,
} from "../runtime/runtime-api.js";
import { dispatchMeituanTranscriptTurn } from "./transcript-dispatch.js";
import type { PluginApi } from "../types.js";

/** 模块级幂等缓存（msg-id，TTL 60s） */
const idempotencyCache: IdempotencyCache = createIdempotencyCache({
  ttlMs: 60_000,
  maxEntries: 10_000,
});

/** dispatchWebhookInbound 入参 */
export type WebhookDispatchParams = {
  api: PluginApi;
  channel: string;
  accountId: string;
  peerId: string;
  shopId: string;
  rawBody: string;
  messageId?: string;
};

/** 派发结果 */
export type WebhookDispatchResult = "dispatched" | "duplicate" | "skipped" | "timed_out";

/**
 * 探测 runtime 是否具备 Transcript 派发能力。
 */
function getTranscriptRuntime(runtime: unknown): PluginRuntime | null {
  const rt = runtime as Record<string, unknown> | null | undefined;
  const channel = rt?.channel as Record<string, unknown> | undefined;
  const reply = channel?.reply as Record<string, unknown> | undefined;
  const routing = channel?.routing as Record<string, unknown> | undefined;
  if (
    typeof reply?.dispatchReplyWithBufferedBlockDispatcher === "function" &&
    typeof routing?.resolveAgentRoute === "function"
  ) {
    return runtime as PluginRuntime;
  }
  return null;
}

function logFromApi(api: PluginApi) {
  return {
    log: (msg: string) => api.logger?.info?.(msg) ?? console.log(msg),
    error: (msg: string) => api.logger?.error?.(msg) ?? console.error(msg),
  };
}

/**
 * 解析 Webhook body 并派发至 Agent Transcript 管线。
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
  const logger = logFromApi(params.api);

  const transcriptRuntime = getTranscriptRuntime(params.api.runtime);
  if (transcriptRuntime) {
    const cfg = (params.api.runtime.config ?? {}) as Record<string, unknown>;
    const result = await dispatchMeituanTranscriptTurn({
      runtime: transcriptRuntime,
      cfg,
      accountId: params.accountId,
      peerId: params.peerId,
      shopId: params.shopId,
      rawText: text,
      messageSid: params.messageId,
      log: logger.log,
      error: logger.error,
    });
    if (!result) {
      return "skipped";
    }
    if (result.timedOut) {
      logger.error(
        result.timeoutUserMessage ??
          `[meituan] agent reply timed out after ${result.dispatchTimeoutMs ?? "unknown"}ms`,
      );
      return "timed_out";
    }
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
