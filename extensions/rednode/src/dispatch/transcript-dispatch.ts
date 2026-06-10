/**
 * @module dispatch/transcript-dispatch
 *
 * Rednode（小红书）Webhook 入站 Transcript 派发。
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
import { resolveXhsAgentReplyTimeoutMs } from "../config/resolvers.js";
import { deliverXhsAgentReplyPayload } from "./outbound-reply.js";

const CHANNEL_ID = "xhs";
const CHANNEL_LABEL = "XHS";
const AGENT_REPLY_TIMEOUT_TEMPLATE =
  "抱歉，处理您的消息超时（约 {minutes} 分钟），请稍后重试。";

export type XhsTranscriptRoute = {
  sessionKey: string;
  agentId?: string;
  accountId?: string;
  mainSessionKey?: string;
};

export type XhsTranscriptDispatchParams = {
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

export type XhsTranscriptDispatchResult = {
  route: XhsTranscriptRoute;
  delivered: boolean;
  timedOut?: boolean;
  dispatchTimeoutMs?: number;
  timeoutUserMessage?: string;
};

function createLogger(opts: { log?: (message: string) => void; error?: (message: string) => void }) {
  return {
    info: (message: string) => (opts.log ?? console.log)(`[rednode] ${message}`),
    warn: (message: string) => (opts.log ?? console.log)(`[rednode] [WARN] ${message}`),
    error: (message: string) => (opts.error ?? console.error)(`[rednode] [ERROR] ${message}`),
  };
}

/**
 * 解析小红书入站 transcript 路由与会话存储路径。
 */
export function resolveXhsTranscriptRoute(params: {
  runtime: PluginRuntime;
  cfg: Record<string, unknown>;
  accountId: string;
  peerId: string;
  log?: (message: string) => void;
}): { route: XhsTranscriptRoute; storePath?: string } | null {
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
 * 构建小红书 Webhook 入站上下文。
 */
export function buildXhsTranscriptInboundContext(params: {
  runtime: PluginRuntime;
  cfg: Record<string, unknown>;
  accountId: string;
  peerId: string;
  shopId: string;
  rawText: string;
  messageSid?: string;
  route: XhsTranscriptRoute;
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
 * 经 message-sdk `dispatchTranscriptTurn` 派发小红书 Webhook 入站。
 */
export async function dispatchXhsTranscriptTurn(
  params: XhsTranscriptDispatchParams,
): Promise<XhsTranscriptDispatchResult | null> {
  const logger = createLogger({ log: params.log, error: params.error });
  const { runtime, cfg, accountId, peerId, shopId } = params;

  const dispatchReply = runtime.channel?.reply?.dispatchReplyWithBufferedBlockDispatcher;
  if (!dispatchReply) {
    logger.warn("runtime buffered reply dispatcher unavailable");
    return null;
  }

  const resolved = resolveXhsTranscriptRoute({
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
  const inboundContext = buildXhsTranscriptInboundContext({
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

  const dispatchTimeoutMs = resolveXhsAgentReplyTimeoutMs(cfg as ChannelLimitsOpenClawConfig);
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
      `XHS dispatch timed out after ${dispatchTimeoutMs}ms`,
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
    const delivery = await deliverXhsAgentReplyPayload({
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
