/**
 * KF 客户消息派发：dm-policy → transcript dispatch → dialogue transitions
 * 对齐 research/openclaw-china/extensions/wecom-kf/src/dispatch.ts
 * 使用 message-sdk：command-auth、dispatchTranscriptTurn、timeout、dm-policy
 */

import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk";

import { extractInboundTextContent } from "./bot.js";
import { checkKfDmPolicy } from "./dm-policy.js";
import { buildKfInboundMediaContext } from "./inbound-media.js";
import { dispatchKfTranscriptTurn, resolveKfTranscriptRoute } from "./kf-transcript-dispatch.js";
import { onKfCustomerInbound } from "../agent/kf-send-guard.js";
import {
  getKfSessionServiceState,
  isKfAgentReplyBlocked,
} from "../state/session-service-state.js";
import { resolveKfAgentAccount } from "../tools/call-context.js";
import {
  applyInboundDialogueTransition,
  applyOutboundDialogueTransition,
} from "../intelligence/dialogue-session.js";
import { sendKfTextMessage } from "../agent/api-client.js";
import {
  buildKfAgentReplyTimeoutSummary,
  resolveWecomKfTemplates,
} from "../config/templates.js";
import { getWecomRuntime } from "../runtime/index.js";
import {
  buildWecomUnauthorizedCommandPrompt,
  resolveWecomCommandAuthorization,
} from "../shared/command-auth.js";
import type { KfMessage, WecomAccountConfig } from "../types/index.js";

function createLogger(opts: { log?: (message: string) => void; error?: (message: string) => void }) {
  return {
    info: (message: string) => (opts.log ?? console.log)(`[wecom-kf] ${message}`),
    warn: (message: string) => (opts.log ?? console.log)(`[wecom-kf] [WARN] ${message}`),
    error: (message: string) => (opts.error ?? console.error)(`[wecom-kf] [ERROR] ${message}`),
  };
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

  const resolvedRoute = resolveKfTranscriptRoute({
    runtime,
    cfg,
    openKfId,
    externalUserId,
    log: params.log,
  });
  if (!resolvedRoute) {
    logger.warn("runtime routing unavailable");
    return;
  }

  try {
    await applyInboundDialogueTransition({
      runtime,
      cfg,
      sessionKey: resolvedRoute.route.sessionKey,
      agentId: resolvedRoute.route.agentId,
      userId: externalUserId,
      text: rawText,
    });
  } catch (error) {
    logger.warn(`dialogue inbound transition failed (non-blocking): ${String(error)}`);
  }

  const result = await dispatchKfTranscriptTurn({
    cfg,
    runtime,
    accountConfig: params.accountConfig,
    openKfId,
    externalUserId,
    rawText,
    messageSid: params.msg.msgid,
    mediaContext,
    commandAuthorized: authz.commandAuthorized ?? true,
    log: params.log,
    error: params.error,
  });

  if (result?.timedOut) {
    const templates = resolveWecomKfTemplates(
      params.accountConfig as unknown as Record<string, unknown>,
    );
    const timeoutText = buildKfAgentReplyTimeoutSummary(
      result.dispatchTimeoutMs ?? 10 * 60 * 1000,
      templates,
    );
    const agent = resolveKfAgentAccount(cfg, openKfId);
    if (agent) {
      try {
        await sendKfTextMessage({
          agent,
          externalUserId,
          text: timeoutText,
          openKfId,
        });
      } catch (err) {
        logger.error(`timeout reply failed: ${String(err)}`);
      }
    }
    return;
  }

  if (!result?.delivered) {
    return;
  }

  try {
    await applyOutboundDialogueTransition({
      runtime,
      cfg,
      sessionKey: result.route.sessionKey,
      agentId: result.route.agentId,
      userId: externalUserId,
    });
  } catch (error) {
    logger.warn(`dialogue outbound transition failed (non-blocking): ${String(error)}`);
  }
}

/** @deprecated 使用 dispatchKfMessage */
export const handleCustomerMessage = dispatchKfMessage;
