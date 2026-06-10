/**
 * 抖音 Webhook 入站派发（message-sdk Transcript + publishInbound 回退）。
 */

import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import {
  createIdempotencyCache,
  normalizeWireIngress,
  type IdempotencyCache,
} from "../runtime/runtime-api.js";
import { dispatchDouyinTranscriptTurn } from "./transcript-dispatch.js";
import type { ResolvedDouyinAccount } from "../types.js";

const idempotencyCache: IdempotencyCache = createIdempotencyCache({
  ttlMs: 60_000,
  maxEntries: 5000,
});

export type DouyinWebhookDispatchParams = {
  runtime: PluginRuntime;
  cfg: Record<string, unknown>;
  account: ResolvedDouyinAccount;
  rawBody: string;
  text: string;
  peerId: string;
  messageId?: string;
  log?: {
    info?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
  };
};

export type DouyinWebhookDispatchResult = "dispatched" | "duplicate" | "skipped" | "timed_out";

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
 * 解析 Webhook 幂等键后派发至 Agent Transcript 管线。
 */
export async function dispatchDouyinWebhookInbound(
  params: DouyinWebhookDispatchParams,
): Promise<DouyinWebhookDispatchResult> {
  const parsed = normalizeWireIngress({
    rawPayload: params.rawBody,
    mode: "jsonTextOrPlain",
    channel: "douyin",
    idempotencyKey: params.messageId,
    idempotency: params.messageId ? idempotencyCache : undefined,
  });
  if (!parsed.accepted) {
    return "duplicate";
  }

  const text = params.text || parsed.text || params.rawBody;
  const shopId = params.account.shop_id ?? params.account.accountId;
  const transcriptRuntime = getTranscriptRuntime(params.runtime);

  if (transcriptRuntime) {
    const result = await dispatchDouyinTranscriptTurn({
      runtime: transcriptRuntime,
      cfg: params.cfg,
      accountId: params.account.accountId,
      peerId: params.peerId,
      shopId,
      rawText: text,
      messageSid: params.messageId,
      log: params.log?.info,
      error: params.log?.error,
    });
    if (!result) {
      return "skipped";
    }
    if (result.timedOut) {
      params.log?.error?.(
        result.timeoutUserMessage ??
          `[douyin] agent reply timed out after ${result.dispatchTimeoutMs ?? "unknown"}ms`,
      );
      return "timed_out";
    }
    return "dispatched";
  }

  params.log?.warn?.("[douyin] inbound skipped: transcript runtime unavailable");
  return "skipped";
}
