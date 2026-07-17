/**
 * 抖音 Webhook 入站派发（message-sdk Transcript + publishInbound 回退）。
 */

import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { normalizeWireIngress } from "../runtime/runtime-api.js";
import { dispatchDouyinTranscriptTurn } from "./transcript-dispatch.js";
import type { ResolvedDouyinAccount } from "../types.js";
import { authorizeDouyinInbound } from "./access-policy.js";
import {
  claimDouyinWebhookMessage,
  commitDouyinWebhookMessage,
  releaseDouyinWebhookMessage,
} from "./inbound-dedupe.js";

/** Webhook 协议层交给 Transcript 派发层的完整、已验签入站上下文。 */
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

/** 入站派发终态，供 HTTP 层决定日志与平台确认语义。 */
export type DouyinWebhookDispatchResult =
  | "dispatched"
  | "duplicate"
  | "blocked"
  | "skipped"
  | "timed_out";

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
  });

  const text = params.text || parsed.text || params.rawBody;
  const shopId = params.account.shop_id ?? params.account.accountId;
  const transcriptRuntime = getTranscriptRuntime(params.runtime);

  if (!transcriptRuntime) {
    params.log?.warn?.("[douyin] inbound skipped: transcript runtime unavailable");
    return "skipped";
  }

  // 自定义 Webhook 路由绕开了 ChannelPlugin 的通用入站适配器，因此必须在这里
  // 显式执行 dmPolicy/allowFrom 与命令授权，不能依赖 channel.ts 的声明自动生效。
  const authorization = await authorizeDouyinInbound({
    runtime: transcriptRuntime,
    cfg: params.cfg,
    account: params.account,
    peerId: params.peerId,
    rawText: text,
    log: params.log,
  });
  if (!authorization.allowed) return "blocked";

  const messageId = params.messageId?.trim();
  if (messageId) {
    const claim = await claimDouyinWebhookMessage(params.account.accountId, messageId);
    if (claim.kind !== "claimed") return "duplicate";
  }

  try {
    const result = await dispatchDouyinTranscriptTurn({
      runtime: transcriptRuntime,
      cfg: params.cfg,
      accountId: params.account.accountId,
      peerId: params.peerId,
      shopId,
      rawText: text,
      messageSid: params.messageId,
      commandAuthorized: authorization.commandAuthorized,
      log: params.log?.info,
      error: params.log?.error,
    });
    if (!result) {
      if (messageId) {
        await releaseDouyinWebhookMessage(params.account.accountId, messageId, "dispatch skipped");
      }
      return "skipped";
    }
    if (result.timedOut) {
      params.log?.error?.(
        result.timeoutUserMessage ??
          `[douyin] agent reply timed out after ${result.dispatchTimeoutMs ?? "unknown"}ms`,
      );
      if (messageId) {
        await releaseDouyinWebhookMessage(params.account.accountId, messageId, "dispatch timed out");
      }
      return "timed_out";
    }
    if (messageId) {
      await commitDouyinWebhookMessage(params.account.accountId, messageId);
    }
    return "dispatched";
  } catch (error) {
    if (messageId) {
      await releaseDouyinWebhookMessage(params.account.accountId, messageId, error);
    }
    throw error;
  }
}
