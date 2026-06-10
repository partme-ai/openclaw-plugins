/**
 * @fileoverview Rednode Webhook 入站 dispatch：Transcript 派发与 publishInbound 回退。
 */

import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import {
  createIdempotencyCache,
  normalizeWireIngress,
  type IdempotencyCache,
} from "../runtime/runtime-api.js";
import { dispatchXhsTranscriptTurn } from "./transcript-dispatch.js";
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

/** @description Webhook 派发结果。 */
export type WebhookDispatchResult = "dispatched" | "duplicate" | "skipped" | "timed_out";

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

/**
 * @description 解析 Webhook body 并派发至 Agent Transcript 管线。
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

  const transcriptRuntime = getTranscriptRuntime(params.api.runtime);
  if (transcriptRuntime) {
    const cfg = (params.api.runtime.config ?? {}) as Record<string, unknown>;
    const result = await dispatchXhsTranscriptTurn({
      runtime: transcriptRuntime,
      cfg,
      accountId: params.accountId,
      peerId: params.peerId,
      shopId: params.shopId,
      rawText: text,
      messageSid: params.messageId,
      log: (msg) => console.log(msg),
      error: (msg) => console.error(msg),
    });
    if (!result) {
      return "skipped";
    }
    if (result.timedOut) {
      console.error(
        result.timeoutUserMessage ??
          `[rednode] agent reply timed out after ${result.dispatchTimeoutMs ?? "unknown"}ms`,
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
