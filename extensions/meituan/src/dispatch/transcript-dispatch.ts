/**
 * @module dispatch/transcript-dispatch
 *
 * 美团 Webhook 入站 Transcript 派发：route → finalizeInboundContext →
 * `dispatchTranscriptTurn`（runAssembled 优先）→ 出站媒体解析与占位投递。
 */

import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import {
  dispatchTranscriptTurn,
  withTimeout,
  TimeoutError,
  buildAgentReplyTimeoutSummary,
  type TranscriptChannelRuntime,
  type ChannelLimitsOpenClawConfig,
} from "../runtime/runtime-api.js";
import { resolveMeituanAgentReplyTimeoutMs } from "../config/resolvers.js";
import { deliverMeituanAgentReplyPayload } from "./outbound-reply.js";

const CHANNEL_ID = "meituan";
const CHANNEL_LABEL = "Meituan";
const AGENT_REPLY_TIMEOUT_TEMPLATE =
  "抱歉，处理您的消息超时（约 {minutes} 分钟），请稍后重试。";

export type MeituanTranscriptRoute = {
  sessionKey: string;
  agentId?: string;
  accountId?: string;
  mainSessionKey?: string;
};

export type MeituanTranscriptDispatchParams = {
  runtime: PluginRuntime;
  cfg: Record<string, unknown>;
  accountId: string;
  peerId: string;
  shopId: string;
  rawText: string;
  messageSid?: string;
  log?: (message: string) => void;
  error?: (message: string) => void;
};

export type MeituanTranscriptDispatchResult = {
  route: MeituanTranscriptRoute;
  delivered: boolean;
  timedOut?: boolean;
  dispatchTimeoutMs?: number;
  timeoutUserMessage?: string;
};

function createLogger(opts: { log?: (message: string) => void; error?: (message: string) => void }) {
  return {
    info: (message: string) => (opts.log ?? console.log)(`[meituan] ${message}`),
    warn: (message: string) => (opts.log ?? console.log)(`[meituan] [WARN] ${message}`),
    error: (message: string) => (opts.error ?? console.error)(`[meituan] [ERROR] ${message}`),
  };
}

/**
 * 解析美团入站 transcript 路由与会话存储路径。
 */
export function resolveMeituanTranscriptRoute(params: {
  runtime: PluginRuntime;
  cfg: Record<string, unknown>;
  accountId: string;
  peerId: string;
  log?: (message: string) => void;
}): { route: MeituanTranscriptRoute; storePath?: string } | null {
  const channel = params.runtime.channel;
  const resolveAgentRoute = channel?.routing?.resolveAgentRoute;
  if (!resolveAgentRoute) {
    return null;
  }

  const route = resolveAgentRoute({
    cfg: params.cfg,
    channel: CHANNEL_ID,
    accountId: params.accountId,
    peer: { kind: "direct" as const, id: params.peerId },
  });

  params.log?.(
    `dispatch route accountId=${params.accountId} agentId=${route.agentId ?? "unknown"} sessionKey=${route.sessionKey}`,
  );

  const storePath = channel.session?.resolveStorePath?.(
    (params.cfg as { session?: { store?: string } }).session?.store,
    {
      agentId: route.agentId,
    },
  );

  return {
    route: {
      sessionKey: route.sessionKey,
      agentId: route.agentId,
      accountId: route.accountId ?? params.accountId,
      mainSessionKey: route.mainSessionKey,
    },
    storePath,
  };
}

/**
 * 构建美团 Webhook 入站上下文（信封 + finalizeInboundContext）。
 */
export function buildMeituanTranscriptInboundContext(params: {
  runtime: PluginRuntime;
  cfg: Record<string, unknown>;
  accountId: string;
  peerId: string;
  shopId: string;
  rawText: string;
  messageSid?: string;
  route: MeituanTranscriptRoute;
  storePath?: string;
}): Record<string, unknown> {
  const { runtime, cfg, accountId, peerId, shopId, rawText, route, storePath } = params;
  const channel = runtime.channel;
  const fromLabel = `shop:${shopId}`;
  const from = `${CHANNEL_ID}:shop:${shopId}`;
  const to = `shop:${shopId}`;

  const previousTimestamp = storePath
    ? channel?.session?.readSessionUpdatedAt?.({
        storePath,
        sessionKey: route.sessionKey,
      })
    : undefined;

  const envelopeOptions = channel?.reply?.resolveEnvelopeFormatOptions?.(cfg);
  const body = channel?.reply?.formatAgentEnvelope
    ? channel.reply.formatAgentEnvelope({
        channel: CHANNEL_LABEL,
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
      From: from,
      To: to,
      SessionKey: route.sessionKey,
      AccountId: route.accountId ?? accountId,
      ChatType: "direct",
      ConversationLabel: fromLabel,
      SenderName: peerId,
      SenderId: peerId,
      Provider: CHANNEL_ID,
      Surface: CHANNEL_ID,
      MessageSid: params.messageSid,
      OriginatingChannel: CHANNEL_ID,
      OriginatingTo: to,
      CommandAuthorized: true,
    }) as Record<string, unknown> | undefined) ?? {
      Body: body,
      RawBody: rawText,
      CommandBody: rawText,
      From: from,
      To: to,
      SessionKey: route.sessionKey,
      AccountId: route.accountId ?? accountId,
      ChatType: "direct",
      ConversationLabel: fromLabel,
      SenderName: peerId,
      SenderId: peerId,
      Provider: CHANNEL_ID,
      Surface: CHANNEL_ID,
      MessageSid: params.messageSid,
      OriginatingChannel: CHANNEL_ID,
      OriginatingTo: to,
      CommandAuthorized: true,
    }
  );
}

/**
 * 经 message-sdk `dispatchTranscriptTurn` 派发美团 Webhook 入站，并解析 Agent 回复。
 */
export async function dispatchMeituanTranscriptTurn(
  params: MeituanTranscriptDispatchParams,
): Promise<MeituanTranscriptDispatchResult | null> {
  const logger = createLogger({ log: params.log, error: params.error });
  const { runtime, cfg, accountId, peerId, shopId } = params;

  const dispatchReply = runtime.channel?.reply?.dispatchReplyWithBufferedBlockDispatcher;
  if (!dispatchReply) {
    logger.warn("runtime buffered reply dispatcher unavailable");
    return null;
  }

  const resolved = resolveMeituanTranscriptRoute({
    runtime,
    cfg,
    accountId,
    peerId,
    log: params.log,
  });
  if (!resolved) {
    logger.warn("runtime routing unavailable");
    return null;
  }

  const { route, storePath } = resolved;
  const inboundContext = buildMeituanTranscriptInboundContext({
    runtime,
    cfg,
    accountId,
    peerId,
    shopId,
    rawText: params.rawText,
    messageSid: params.messageSid,
    route,
    storePath,
  });

  const responseChunks: string[] = [];
  const responseMediaUrls: string[] = [];

  const deliver = async (payload: { text?: string; mediaUrls?: string[]; mediaUrl?: string }) => {
    const text = String(payload.text ?? "").trim();
    if (text) {
      responseChunks.push(text);
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

  const dispatchTimeoutMs = resolveMeituanAgentReplyTimeoutMs(cfg as ChannelLimitsOpenClawConfig);
  const agentId = route.agentId ?? "main";

  try {
    await withTimeout(
      dispatchTranscriptTurn({
        channelRuntime: runtime.channel as unknown as TranscriptChannelRuntime,
        cfg,
        channel: CHANNEL_ID,
        accountId,
        agentId,
        sessionKey: route.sessionKey,
        storePath,
        inboundContext,
        record: {
          updateLastRoute: {
            sessionKey: String((route.mainSessionKey ?? route.sessionKey) || route.sessionKey),
            channel: CHANNEL_ID,
            to: `shop:${shopId}`,
            accountId: route.accountId ?? accountId,
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
      `Meituan dispatch timed out after ${dispatchTimeoutMs}ms`,
    );
  } catch (error) {
    if (error instanceof TimeoutError) {
      logger.error(`dispatchTranscriptTurn timed out after ${dispatchTimeoutMs}ms`);
      const timeoutUserMessage = buildAgentReplyTimeoutSummary(
        dispatchTimeoutMs,
        AGENT_REPLY_TIMEOUT_TEMPLATE,
      );
      return { route, delivered: false, timedOut: true, dispatchTimeoutMs, timeoutUserMessage };
    }
    logger.error(`dispatchTranscriptTurn failed: ${String(error)}`);
    return { route, delivered: false };
  }

  const combined = responseChunks.join("\n\n").trim();
  if (!combined && responseMediaUrls.length === 0) {
    return { route, delivered: false };
  }

  try {
    const delivery = await deliverMeituanAgentReplyPayload({
      cfg,
      shopId,
      peerId,
      text: combined,
      mediaUrls: responseMediaUrls,
      log: params.log,
    });
    return { route, delivered: delivery.ok };
  } catch (error) {
    logger.error(`reply send failed: ${String(error)}`);
    return { route, delivered: false };
  }
}
