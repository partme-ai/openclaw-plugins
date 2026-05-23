/**
 * @module agent/system-event
 *
 * 系统事件处理器（origin=4 · msgtype=event）：
 * - `enter_session` → 欢迎语（send_msg_on_event）
 * - `session_status_change` → 更新 service_state；结束时会话消息
 * - `msg_send_fail` → lastError 可观测
 *
 * 参考企微文档 95122 / 94670
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { KfMessage, EventMessagesConfig } from "../types/index.js";
import { sendKfWelcomeMessage } from "./api-client.js";
import {
  extractEventMessageText,
  getEventMessagesConfig,
} from "../config/event-messages.js";
import { resolveKfAgentAccount } from "../kf/call-context.js";
import {
  dispatchKfEventMessageByCode,
} from "../kf/event-message-dispatch.js";
import {
  enqueueKfSessionSideEffect,
} from "../kf/session-side-effect-store.js";
import {
  setKfSessionServiceState,
} from "../kf/session-service-state.js";
import { getWecomRuntime } from "../runtime.js";
import { trackAccountStatePatch } from "../webhook/callback.js";

type KfSystemEventAccountConfig = {
  corpId?: string;
  corpSecret?: string;
  agentId?: number | string;
  welcomeText?: string;
  openKfId?: string;
  [key: string]: unknown;
};

/**
 * 从 event-messages 或账号 welcomeText 解析欢迎语文案。
 */
export async function resolveKfWelcomeText(params: {
  openKfId: string;
  accountConfig: KfSystemEventAccountConfig;
}): Promise<string | undefined> {
  const eventMessages = await getEventMessagesConfig(params.openKfId);
  const fromEventMessages = extractEventMessageText(eventMessages.welcome);
  if (fromEventMessages) return fromEventMessages;
  return params.accountConfig.welcomeText?.trim() || undefined;
}

/**
 * 提取欢迎语配置中的文本内容。
 * @deprecated 使用 config/event-messages.extractEventMessageText
 */
export function extractWelcomeContent(
  welcome: EventMessagesConfig["welcome"] | undefined,
): string | undefined {
  return extractEventMessageText(welcome);
}

/**
 * 读取 sync_msg 系统事件 payload（msg.event.*）。
 */
export function readKfSystemEventFields(msg: KfMessage): {
  eventType?: string;
  welcomeCode?: string;
  failMsgId?: string;
  failType?: number;
  serviceState?: number;
  changeType?: number;
  msgCode?: string;
  externalUserId?: string;
} {
  const eventPayload = (msg as Record<string, unknown>).event as Record<string, unknown> | undefined;
  return {
    eventType: eventPayload?.event_type as string | undefined,
    welcomeCode: eventPayload?.welcome_code as string | undefined,
    failMsgId: eventPayload?.fail_msgid as string | undefined,
    failType: eventPayload?.fail_type as number | undefined,
    serviceState: eventPayload?.service_state as number | undefined,
    changeType: eventPayload?.change_type as number | undefined,
    msgCode: eventPayload?.msg_code as string | undefined,
    externalUserId:
      (eventPayload?.external_userid as string | undefined)?.trim() ||
      (msg.external_userid as string | undefined)?.trim(),
  };
}

/**
 * 根据 session_status_change 推断 service_state。
 *
 * change_type: 1=接待池接入, 2=转接, 3=结束, 4=重新接入
 */
export function inferServiceStateFromSessionChange(params: {
  serviceState?: number;
  changeType?: number;
}): number | undefined {
  if (typeof params.serviceState === "number" && Number.isFinite(params.serviceState)) {
    return params.serviceState;
  }
  switch (params.changeType) {
    case 1:
      return 3;
    case 2:
      return 3;
    case 3:
      return 4;
    case 4:
      return 3;
    default:
      return undefined;
  }
}

async function handleEnterSession(params: {
  msg: KfMessage;
  accountConfig: KfSystemEventAccountConfig;
  openKfId: string;
  welcomeCode?: string;
}): Promise<void> {
  const welcomeText = await resolveKfWelcomeText({
    openKfId: params.openKfId,
    accountConfig: params.accountConfig,
  });
  if (!params.welcomeCode || !welcomeText) return;

  let cfg: OpenClawConfig;
  try {
    cfg = getWecomRuntime().config as OpenClawConfig;
  } catch {
    console.error("[wecom_kf] Cannot send welcome: runtime unavailable");
    return;
  }

  const agent = resolveKfAgentAccount(cfg, params.openKfId);
  if (!agent) {
    console.error("[wecom_kf] Cannot send welcome: corpId or corpSecret not configured");
    return;
  }

  try {
    const result = await sendKfWelcomeMessage(agent, {
      code: params.welcomeCode,
      open_kfid: params.openKfId || undefined,
      msgtype: "text",
      text: { content: welcomeText },
    });
    if (result.errcode !== 0) {
      console.error(
        `[wecom_kf] Welcome send failed: ${result.errmsg} (errcode=${result.errcode})`,
      );
      trackAccountStatePatch(params.openKfId, {
        lastError: `welcome_send_failed:${result.errcode}`,
      });
    }
  } catch (error) {
    console.error("[wecom_kf] Welcome send error:", error);
  }
}

async function handleSessionStatusChange(params: {
  msg: KfMessage;
  accountConfig: KfSystemEventAccountConfig;
  openKfId: string;
  serviceState?: number;
  changeType?: number;
  msgCode?: string;
  externalUserId?: string;
}): Promise<void> {
  const externalUserId = params.externalUserId?.trim();
  const inferredState = inferServiceStateFromSessionChange({
    serviceState: params.serviceState,
    changeType: params.changeType,
  });

  if (externalUserId && inferredState != null) {
    await setKfSessionServiceState({
      openKfId: params.openKfId,
      externalUserId,
      serviceState: inferredState,
      changeType: params.changeType,
    });
    console.log(
      `[wecom_kf] session_status_change open_kfid=${params.openKfId} user=${externalUserId} ` +
        `service_state=${inferredState} change_type=${params.changeType ?? "unknown"}`,
    );
  }

  const msgCode = params.msgCode?.trim();
  if (!msgCode || !externalUserId) return;

  let cfg: OpenClawConfig;
  try {
    cfg = getWecomRuntime().config as OpenClawConfig;
  } catch {
    return;
  }

  const agent = resolveKfAgentAccount(cfg, params.openKfId);
  if (!agent) return;

  const targetState = inferredState ?? params.serviceState ?? 4;
  await enqueueKfSessionSideEffect({
    msgCode,
    openKfId: params.openKfId,
    externalUserId,
    serviceState: targetState,
  });

  await dispatchKfEventMessageByCode({
    agent,
    openKfId: params.openKfId,
    msgCode,
    serviceState: targetState,
  });
}

/**
 * 处理系统事件（origin=4 且 msgtype=event）
 */
export async function handleSystemEvent(
  msg: KfMessage,
  accountConfig: KfSystemEventAccountConfig,
): Promise<void> {
  const openKfId = (msg.open_kfid as string | undefined)?.trim() ?? accountConfig.openKfId?.trim() ?? "";
  const fields = readKfSystemEventFields(msg);

  if (fields.eventType === "enter_session") {
    await handleEnterSession({
      msg,
      accountConfig,
      openKfId,
      welcomeCode: fields.welcomeCode,
    });
    return;
  }

  if (fields.eventType === "session_status_change") {
    await handleSessionStatusChange({
      msg,
      accountConfig,
      openKfId,
      serviceState: fields.serviceState,
      changeType: fields.changeType,
      msgCode: fields.msgCode,
      externalUserId: fields.externalUserId,
    });
    return;
  }

  if (fields.eventType === "msg_send_fail") {
    const failDetail = `fail_msgid=${fields.failMsgId ?? "unknown"} fail_type=${fields.failType ?? "unknown"}`;
    console.warn(`[wecom_kf] msg_send_fail: ${failDetail}`);
    if (openKfId) {
      trackAccountStatePatch(openKfId, { lastError: `msg_send_fail:${fields.failType ?? "unknown"}` });
    }
    return;
  }

  console.log(`[wecom_kf] Unhandled system event: ${fields.eventType ?? "unknown"}`);
}
