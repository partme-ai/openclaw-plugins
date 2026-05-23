/**
 * KF 客户消息派发：resolveAgentRoute → dispatchReply → sendKfTextMessage
 * 对齐 research/openclaw-china/extensions/wecom-kf/src/dispatch.ts
 * 使用 message-sdk：command-auth、stripMarkdown（经 api-client）、timeout、dm-policy
 */

import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk";

import { extractInboundTextContent } from "./bot.js";
import { checkKfDmPolicy } from "./dm-policy.js";
import { buildKfInboundMediaContext } from "./dispatch/inbound-media.js";
import { onKfCustomerInbound } from "./agent/kf-send-guard.js";
import {
  getKfSessionServiceState,
  isKfAgentReplyBlocked,
} from "./kf/session-service-state.js";
import { resolveKfAccountByOpenKfId } from "./config/accounts.js";
import { resolveKfAgentAccount } from "./kf/call-context.js";
import {
  applyInboundDialogueTransition,
  applyOutboundDialogueTransition,
} from "./intelligence/dialogue-session.js";
import { sendKfTextMessage } from "./agent/api-client.js";
import { deliverKfAgentReplyPayload } from "./outbound/kf-send.js";
import { getWecomRuntime } from "./runtime.js";
import {
  buildWecomUnauthorizedCommandPrompt,
  resolveWecomCommandAuthorization,
} from "./shared/command-auth.js";
import { withTimeout } from "./timeout.js";
import type { KfMessage, WecomAccountConfig } from "./types/index.js";
import { LIMITS } from "./types/constants.js";

const DEFAULT_DISPATCH_TIMEOUT_MS = 10 * 60 * 1000;

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
 * 将 sync_msg 客户消息派发到 OpenClaw Agent，并通过 KF API 回发文本。
 */
export async function dispatchKfMessage(params: {
  cfg: OpenClawConfig;
  accountConfig: WecomAccountConfig;
  msg: KfMessage;
  core?: PluginRuntime;
  log?: (message: string) => void;
  error?: (message: string) => void;
}): Promise<void> {
  const logger = createLogger({ log: params.log, error: params.error });
  const previewText = extractInboundTextContent(params.msg);

  if (!previewText) {
    logger.info(`skip unsupported inbound msgtype=${params.msg.msgtype} msgid=${params.msg.msgid ?? "unknown"}`);
    return;
  }

  const externalUserId = (params.msg.external_userid ?? "").trim();
  if (!externalUserId) {
    logger.warn(`skip inbound msgid=${params.msg.msgid ?? "unknown"} without external_userid`);
    return;
  }

  const openKfId =
    (params.msg.open_kfid as string | undefined)?.trim() ??
    params.accountConfig.openKfId?.trim() ??
    "";
  if (!openKfId) {
    logger.warn(`skip inbound msgid=${params.msg.msgid ?? "unknown"} without open_kfid`);
    return;
  }

  const runtime = params.core ?? getWecomRuntime();
  const cfg = params.cfg;

  const dmResult = await checkKfDmPolicy({
    core: runtime,
    cfg,
    accountConfig: params.accountConfig,
    openKfId,
    senderId: externalUserId,
    log: params.log,
    error: params.error,
  });
  if (!dmResult.allowed) {
    logger.info(`skip sender=${externalUserId} reason=dm_policy`);
    return;
  }

  const sessionState = await getKfSessionServiceState(openKfId, externalUserId);
  if (isKfAgentReplyBlocked(sessionState?.serviceState)) {
    logger.info(
      `skip sender=${externalUserId} reason=service_state_${sessionState?.serviceState ?? "unknown"} ` +
        `(human/closed session — Agent auto-reply disabled)`,
    );
    return;
  }

  await onKfCustomerInbound({
    openKfId,
    externalUserId,
    msgId: params.msg.msgid,
    sendTimeMs:
      typeof params.msg.send_time === "number" ? params.msg.send_time * 1000 : Date.now(),
  });

  const channel = runtime.channel;
  const resolveAgentRoute = channel?.routing?.resolveAgentRoute;
  const dispatchReply = channel?.reply?.dispatchReplyWithBufferedBlockDispatcher;
  if (!resolveAgentRoute || !dispatchReply) {
    const message = "runtime routing or buffered reply dispatcher unavailable";
    logger.warn(message);
    return;
  }

  const authz = await resolveWecomCommandAuthorization({
    core: runtime,
    cfg,
    accountConfig: { dm: params.accountConfig.agent?.dm ?? params.accountConfig.bot?.dm ?? { policy: "open" } },
    rawBody: previewText,
    senderUserId: externalUserId,
  });
  if (authz.shouldComputeAuth && authz.commandAuthorized !== true) {
    const prompt = buildWecomUnauthorizedCommandPrompt({
      senderUserId: externalUserId,
      dmPolicy: authz.dmPolicy,
      scope: "kf",
    });
    const agent = resolveKfAgentAccount(cfg, openKfId);
    if (agent) {
      try {
        await sendKfTextMessage({
          agent,
          externalUserId,
          text: prompt,
          openKfId,
        });
      } catch (err) {
        logger.error(`unauthorized command reply failed: ${String(err)}`);
      }
    }
    return;
  }

  const mediaContext = await buildKfInboundMediaContext({
    cfg,
    msg: params.msg,
    openKfId,
    baseContent: previewText,
    core: runtime,
    log: params.log,
    error: params.error,
  });
  const rawText = mediaContext.finalContent;
  const kfResolved = resolveKfAccountByOpenKfId({ cfg, openKfId });
  const route = resolveAgentRoute({
    cfg,
    channel: "wecom-kf",
    accountId: openKfId,
    peer: { kind: "direct" as const, id: externalUserId },
  });

  logger.info(
    `dispatch route open_kfid=${openKfId} accountKey=${kfResolved?.accountKey ?? "unknown"} ` +
      `agentId=${route.agentId ?? kfResolved?.agentId ?? "unknown"} sessionKey=${route.sessionKey}`,
  );

  const fromLabel = `user:${externalUserId}`;
  const from = `wecom-kf:user:${externalUserId}`;
  const to = `user:${externalUserId}`;
  const storePath = channel.session?.resolveStorePath?.(cfg.session?.store, {
    agentId: route.agentId,
  });
  const previousTimestamp = channel.session?.readSessionUpdatedAt?.({
    storePath,
    sessionKey: route.sessionKey,
  });
  const envelopeOptions = channel.reply?.resolveEnvelopeFormatOptions?.(cfg);
  const body = channel.reply?.formatAgentEnvelope
    ? channel.reply.formatAgentEnvelope({
        channel: "WeCom KF",
        from: fromLabel,
        previousTimestamp: previousTimestamp ?? undefined,
        envelope: envelopeOptions,
        body: rawText,
      })
    : rawText;

  const ctxPayload =
    (channel.reply?.finalizeInboundContext?.({
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
      MessageSid: params.msg.msgid,
      OriginatingChannel: "wecom-kf",
      OriginatingTo: to,
      CommandAuthorized: authz.commandAuthorized ?? true,
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
      MessageSid: params.msg.msgid,
      OriginatingChannel: "wecom-kf",
      OriginatingTo: to,
      CommandAuthorized: authz.commandAuthorized ?? true,
      MediaPath: mediaContext.mediaPath,
      MediaType: mediaContext.mediaType,
      MediaUrl: mediaContext.mediaPath,
    };

  if (channel.session?.recordInboundSession && storePath) {
    await channel.session.recordInboundSession({
      storePath,
      sessionKey: String(ctxPayload.SessionKey ?? route.sessionKey),
      ctx: ctxPayload,
      updateLastRoute: {
        sessionKey: String((route.mainSessionKey ?? route.sessionKey) || route.sessionKey),
        channel: "wecom-kf",
        to,
        accountId: route.accountId ?? openKfId,
      },
      onRecordError: (error: unknown) => {
        logger.error(`recordInboundSession failed: ${String(error)}`);
      },
    });
  }

  try {
    await applyInboundDialogueTransition({
      runtime,
      cfg,
      sessionKey: route.sessionKey,
      agentId: route.agentId,
      userId: externalUserId,
      text: rawText,
    });
  } catch (error) {
    logger.warn(`dialogue inbound transition failed (non-blocking): ${String(error)}`);
  }

  const convertTables = (text: string): string => {
    try {
      const mode = channel.text?.resolveMarkdownTableMode?.({
        cfg,
        channel: "wecom-kf",
        accountId: openKfId,
      });
      if (mode != null && channel.text?.convertMarkdownTables) {
        return channel.text.convertMarkdownTables(text, mode);
      }
    } catch {
      // 非阻塞
    }
    return text;
  };

  const responseChunks: string[] = [];
  const responseMediaUrls: string[] = [];
  const dispatchTimeoutMs = resolveDispatchTimeoutMs(params.accountConfig);

  await withTimeout(
    dispatchReply({
      ctx: ctxPayload,
      cfg,
      dispatcherOptions: {
        deliver: async (payload: { text?: string; mediaUrls?: string[]; mediaUrl?: string }) => {
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
        },
        onError: (error: unknown, info: { kind: string }) => {
          logger.error(`${info.kind} reply failed: ${String(error)}`);
        },
      },
    }),
    dispatchTimeoutMs,
    `KF dispatch timed out after ${dispatchTimeoutMs}ms`,
  ).catch((error) => {
    logger.error(`dispatchReply failed: ${String(error)}`);
  });

  const combined = responseChunks.join("\n\n").trim();
  if (!combined && responseMediaUrls.length === 0) {
    return;
  }

  try {
    await applyOutboundDialogueTransition({
      runtime,
      cfg,
      sessionKey: route.sessionKey,
      agentId: route.agentId,
      userId: externalUserId,
    });
  } catch (error) {
    logger.warn(`dialogue outbound transition failed (non-blocking): ${String(error)}`);
  }

  const agent = resolveKfAgentAccount(cfg, openKfId);
  if (!agent) {
    logger.warn(`skip outbound: missing corp credentials open_kfid=${openKfId}`);
    return;
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
    }
  } catch (error) {
    logger.error(`reply send failed: ${String(error)}`);
  }
}

/** @deprecated 使用 dispatchKfMessage */
export const handleCustomerMessage = dispatchKfMessage;
