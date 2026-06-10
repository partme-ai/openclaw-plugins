/**
 * @module dispatch/kf-transcript-dispatch
 *
 * KF 客户消息 Transcript 派发：route → finalizeInboundContext → record →
 * `dispatchTranscriptTurn`（runAssembled 优先）→ `deliverKfAgentReplyPayload`。
 */

import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk";
import {
  dispatchTranscriptTurn,
  type TranscriptChannelRuntime,
} from "@partme.ai/openclaw-message-sdk";

import { deliverKfAgentReplyPayload } from "../outbound/kf-send.js";
import { resolveKfAccountByOpenKfId } from "../config/accounts.js";
import { resolveKfAgentAccount } from "../tools/call-context.js";
import { TimeoutError, withTimeout } from "../shared/http.js";
import type { KfInboundMediaContext } from "./inbound-media.js";
import type { WecomAccountConfig } from "../types/index.js";
import { LIMITS } from "../types/constants.js";

const DEFAULT_DISPATCH_TIMEOUT_MS = 10 * 60 * 1000;

export type KfTranscriptRoute = {
  sessionKey: string;
  agentId?: string;
  accountId?: string;
  mainSessionKey?: string;
};

export type KfTranscriptDispatchParams = {
  cfg: OpenClawConfig;
  runtime: PluginRuntime;
  accountConfig: WecomAccountConfig;
  openKfId: string;
  externalUserId: string;
  rawText: string;
  messageSid?: string;
  mediaContext: KfInboundMediaContext;
  commandAuthorized: boolean;
  log?: (message: string) => void;
  error?: (message: string) => void;
};

export type KfTranscriptDispatchResult = {
  route: KfTranscriptRoute;
  delivered: boolean;
  /** Agent 派发是否因超时失败 */
  timedOut?: boolean;
  /** 实际使用的派发超时（毫秒），超时兜底文案会用到 */
  dispatchTimeoutMs?: number;
};

function createLogger(opts: { log?: (message: string) => void; error?: (message: string) => void }) {
  return {
    info: (message: string) => (opts.log ?? console.log)(`[wecom-kf] ${message}`),
    warn: (message: string) => (opts.log ?? console.log)(`[wecom-kf] [WARN] ${message}`),
    error: (message: string) => (opts.error ?? console.error)(`[wecom-kf] [ERROR] ${message}`),
  };
}

/**
 * 解析 Agent 回复派发超时（毫秒）。
 */
function resolveDispatchTimeoutMs(accountConfig: WecomAccountConfig): number {
  const configured = (accountConfig as { network?: { timeoutMs?: number } }).network?.timeoutMs;
  if (typeof configured === "number" && configured > 0) {
    return Math.max(configured * 40, LIMITS.REQUEST_TIMEOUT_MS);
  }
  return DEFAULT_DISPATCH_TIMEOUT_MS;
}

/**
 * 按通道配置将 Markdown 表格转为纯文本（非阻塞）。
 */
function convertMarkdownTables(params: {
  runtime: PluginRuntime;
  cfg: OpenClawConfig;
  openKfId: string;
  text: string;
}): string {
  const channel = params.runtime.channel;
  try {
    const mode = channel?.text?.resolveMarkdownTableMode?.({
      cfg: params.cfg,
      channel: "wecom-kf",
      accountId: params.openKfId,
    });
    if (mode != null && channel?.text?.convertMarkdownTables) {
      return channel.text.convertMarkdownTables(params.text, mode);
    }
  } catch {
    // 非阻塞
  }
  return params.text;
}

/**
 * 解析 KF 入站 transcript 路由与会话存储路径。
 */
export function resolveKfTranscriptRoute(params: {
  runtime: PluginRuntime;
  cfg: OpenClawConfig;
  openKfId: string;
  externalUserId: string;
  log?: (message: string) => void;
}): { route: KfTranscriptRoute; storePath?: string } | null {
  const channel = params.runtime.channel;
  const resolveAgentRoute = channel?.routing?.resolveAgentRoute;
  if (!resolveAgentRoute) {
    return null;
  }

  const kfResolved = resolveKfAccountByOpenKfId({ cfg: params.cfg, openKfId: params.openKfId });
  const route = resolveAgentRoute({
    cfg: params.cfg,
    channel: "wecom-kf",
    accountId: params.openKfId,
    peer: { kind: "direct" as const, id: params.externalUserId },
  });

  params.log?.(
    `dispatch route open_kfid=${params.openKfId} accountKey=${kfResolved?.accountKey ?? "unknown"} ` +
      `agentId=${route.agentId ?? kfResolved?.agentId ?? "unknown"} sessionKey=${route.sessionKey}`,
  );

  const storePath = channel.session?.resolveStorePath?.(params.cfg.session?.store, {
    agentId: route.agentId,
  });

  return {
    route: {
      sessionKey: route.sessionKey,
      agentId: route.agentId,
      accountId: route.accountId ?? params.openKfId,
      mainSessionKey: route.mainSessionKey,
    },
    storePath,
  };
}

/**
 * 构建 KF 客户消息入站上下文（信封 + finalizeInboundContext）。
 */
export function buildKfTranscriptInboundContext(params: {
  runtime: PluginRuntime;
  cfg: OpenClawConfig;
  openKfId: string;
  externalUserId: string;
  rawText: string;
  messageSid?: string;
  mediaContext: KfInboundMediaContext;
  route: KfTranscriptRoute;
  storePath?: string;
  commandAuthorized: boolean;
}): Record<string, unknown> {
  const { runtime, cfg, openKfId, externalUserId, rawText, mediaContext, route, storePath } = params;
  const channel = runtime.channel;
  const fromLabel = `user:${externalUserId}`;
  const from = `wecom-kf:user:${externalUserId}`;
  const to = `user:${externalUserId}`;

  const previousTimestamp = storePath
    ? channel?.session?.readSessionUpdatedAt?.({
        storePath,
        sessionKey: route.sessionKey,
      })
    : undefined;

  const envelopeOptions = channel?.reply?.resolveEnvelopeFormatOptions?.(cfg);
  const body = channel?.reply?.formatAgentEnvelope
    ? channel.reply.formatAgentEnvelope({
        channel: "WeCom KF",
        from: fromLabel,
        previousTimestamp: previousTimestamp ?? undefined,
        envelope: envelopeOptions,
        body: rawText,
      })
    : rawText;

  return (
    (channel?.reply?.finalizeInboundContext?.({
      Body: body,
      RawBody: rawText,
      CommandBody: rawText,
      Attachments: mediaContext.attachments.length > 0 ? mediaContext.attachments : undefined,
      From: from,
      To: to,
      SessionKey: route.sessionKey,
      AccountId: route.accountId ?? openKfId,
      ChatType: "direct",
      ConversationLabel: fromLabel,
      SenderName: externalUserId,
      SenderId: externalUserId,
      Provider: "wecom-kf",
      Surface: "wecom-kf",
      MessageSid: params.messageSid,
      OriginatingChannel: "wecom-kf",
      OriginatingTo: to,
      CommandAuthorized: params.commandAuthorized,
      MediaPath: mediaContext.mediaPath,
      MediaType: mediaContext.mediaType,
      MediaUrl: mediaContext.mediaPath,
    }) as Record<string, unknown> | undefined) ?? {
      Body: body,
      RawBody: rawText,
      CommandBody: rawText,
      Attachments: mediaContext.attachments.length > 0 ? mediaContext.attachments : undefined,
      From: from,
      To: to,
      SessionKey: route.sessionKey,
      AccountId: route.accountId ?? openKfId,
      ChatType: "direct",
      ConversationLabel: fromLabel,
      SenderName: externalUserId,
      SenderId: externalUserId,
      Provider: "wecom-kf",
      Surface: "wecom-kf",
      MessageSid: params.messageSid,
      OriginatingChannel: "wecom-kf",
      OriginatingTo: to,
      CommandAuthorized: params.commandAuthorized,
      MediaPath: mediaContext.mediaPath,
      MediaType: mediaContext.mediaType,
      MediaUrl: mediaContext.mediaPath,
    }
  );
}

/**
 * 经 message-sdk `dispatchTranscriptTurn` 派发 KF 客户消息，并回发 Agent 回复。
 */
export async function dispatchKfTranscriptTurn(
  params: KfTranscriptDispatchParams,
): Promise<KfTranscriptDispatchResult | null> {
  const logger = createLogger({ log: params.log, error: params.error });
  const { runtime, cfg, openKfId, externalUserId } = params;

  const dispatchReply = runtime.channel?.reply?.dispatchReplyWithBufferedBlockDispatcher;
  if (!dispatchReply) {
    logger.warn("runtime buffered reply dispatcher unavailable");
    return null;
  }

  const resolved = resolveKfTranscriptRoute({
    runtime,
    cfg,
    openKfId,
    externalUserId,
    log: params.log,
  });
  if (!resolved) {
    logger.warn("runtime routing unavailable");
    return null;
  }

  const { route, storePath } = resolved;
  const inboundContext = buildKfTranscriptInboundContext({
    runtime,
    cfg,
    openKfId,
    externalUserId,
    rawText: params.rawText,
    messageSid: params.messageSid,
    mediaContext: params.mediaContext,
    route,
    storePath,
    commandAuthorized: params.commandAuthorized,
  });

  const responseChunks: string[] = [];
  const responseMediaUrls: string[] = [];
  const convertTables = (text: string) =>
    convertMarkdownTables({ runtime, cfg, openKfId, text });

  const deliver = async (payload: { text?: string; mediaUrls?: string[]; mediaUrl?: string }) => {
    const text = String(payload.text ?? "").trim();
    if (text) {
      responseChunks.push(convertTables(text));
    }
    for (const url of payload.mediaUrls ?? []) {
      const trimmed = String(url ?? "").trim();
      if (trimmed && !responseMediaUrls.includes(trimmed)) {
        responseMediaUrls.push(trimmed);
      }
    }
    const single = String(payload.mediaUrl ?? "").trim();
    if (single && !responseMediaUrls.includes(single)) {
      responseMediaUrls.push(single);
    }
  };

  const dispatchTimeoutMs = resolveDispatchTimeoutMs(params.accountConfig);
  const agentId = route.agentId ?? "main";

  try {
    await withTimeout(
      dispatchTranscriptTurn({
        channelRuntime: runtime.channel as unknown as TranscriptChannelRuntime,
        cfg: cfg as unknown as Record<string, unknown>,
        channel: "wecom-kf",
        accountId: openKfId,
        agentId,
        sessionKey: route.sessionKey,
        storePath,
        inboundContext,
        record: {
          updateLastRoute: {
            sessionKey: String((route.mainSessionKey ?? route.sessionKey) || route.sessionKey),
            channel: "wecom-kf",
            to: `user:${externalUserId}`,
            accountId: route.accountId ?? openKfId,
          },
          onRecordError: (error: unknown) => {
            logger.error(`recordInboundSession failed: ${String(error)}`);
          },
        },
        delivery: {
          deliver,
          onError: (error: unknown) => {
            logger.error(`reply failed: ${String(error)}`);
          },
        },
      }),
      dispatchTimeoutMs,
      `KF dispatch timed out after ${dispatchTimeoutMs}ms`,
    );
  } catch (error) {
    if (error instanceof TimeoutError) {
      logger.error(`dispatchTranscriptTurn timed out after ${dispatchTimeoutMs}ms`);
      return { route, delivered: false, timedOut: true, dispatchTimeoutMs };
    }
    logger.error(`dispatchTranscriptTurn failed: ${String(error)}`);
    return { route, delivered: false };
  }

  const combined = responseChunks.join("\n\n").trim();
  if (!combined && responseMediaUrls.length === 0) {
    return { route, delivered: false };
  }

  const agent = resolveKfAgentAccount(cfg, openKfId);
  if (!agent) {
    logger.warn(`skip outbound: missing corp credentials open_kfid=${openKfId}`);
    return { route, delivered: false };
  }

  try {
    const delivery = await deliverKfAgentReplyPayload({
      cfg,
      openKfId,
      externalUserId,
      agent,
      text: combined,
      mediaUrls: responseMediaUrls,
    });
    if (!delivery.ok) {
      logger.error(`reply send failed: ${delivery.error ?? "unknown error"}`);
      return { route, delivered: false };
    }
    return { route, delivered: true };
  } catch (error) {
    logger.error(`reply send failed: ${String(error)}`);
    return { route, delivered: false };
  }
}
