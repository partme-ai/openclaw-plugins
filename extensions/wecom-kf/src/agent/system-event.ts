/**
 * 系统事件处理器
 * 处理企微客服系统事件：进入会话(enter_session)、消息发送失败(msg_send_fail)等
 * 欢迎语通过 kf/send_msg_on_event 发送，参考企微文档 95122
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { KfMessage, EventMessagesConfig } from "../types/index.js";
import { sendKfWelcomeMessage } from "./api-client.js";
import { getEventMessagesConfig } from "../config/event-messages.js";
import { resolveKfAgentAccount } from "../kf/call-context.js";
import { getWecomRuntime } from "../runtime.js";

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
  const fromEventMessages = extractWelcomeContent(eventMessages.welcome);
  if (fromEventMessages) return fromEventMessages;
  return params.accountConfig.welcomeText?.trim() || undefined;
}

/**
 * 提取欢迎语配置中的文本内容。
 */
export function extractWelcomeContent(
  welcome: EventMessagesConfig["welcome"] | undefined,
): string | undefined {
  if (!welcome?.enabled) return undefined;
  const content = welcome.content as Record<string, unknown> | undefined;
  if (!content) return undefined;

  const nestedText = content.text as Record<string, unknown> | undefined;
  if (typeof nestedText?.content === "string" && nestedText.content.trim()) {
    return nestedText.content.trim();
  }
  if (typeof content.content === "string" && content.content.trim()) {
    return content.content.trim();
  }
  return undefined;
}

/**
 * 读取 sync_msg 系统事件 payload（msg.event.*）。
 */
export function readKfSystemEventFields(msg: KfMessage): {
  eventType?: string;
  welcomeCode?: string;
  failMsgId?: string;
  failType?: number;
} {
  const eventPayload = (msg as Record<string, unknown>).event as Record<string, unknown> | undefined;
  return {
    eventType: eventPayload?.event_type as string | undefined,
    welcomeCode: eventPayload?.welcome_code as string | undefined,
    failMsgId: eventPayload?.fail_msgid as string | undefined,
    failType: eventPayload?.fail_type as number | undefined,
  };
}

/**
 * 处理系统事件（origin=4 且 msgtype=event）
 */
export async function handleSystemEvent(
  msg: KfMessage,
  accountConfig: KfSystemEventAccountConfig,
): Promise<void> {
  const openKfId = (msg.open_kfid as string | undefined)?.trim() ?? accountConfig.openKfId?.trim() ?? "";
  const { eventType, welcomeCode, failMsgId, failType } = readKfSystemEventFields(msg);

  if (eventType === "enter_session") {
    const welcomeText = await resolveKfWelcomeText({ openKfId, accountConfig });
    if (!welcomeCode || !welcomeText) return;

    let cfg: OpenClawConfig;
    try {
      cfg = getWecomRuntime().config as OpenClawConfig;
    } catch {
      console.error("[wecom_kf] Cannot send welcome: runtime unavailable");
      return;
    }

    const agent = resolveKfAgentAccount(cfg, openKfId);
    if (!agent) {
      console.error("[wecom_kf] Cannot send welcome: corpId or corpSecret not configured");
      return;
    }

    try {
      const result = await sendKfWelcomeMessage(agent, {
        code: welcomeCode,
        open_kfid: openKfId || undefined,
        msgtype: "text",
        text: { content: welcomeText },
      });
      if (result.errcode !== 0) {
        console.error(
          `[wecom_kf] Welcome send failed: ${result.errmsg} (errcode=${result.errcode})`,
        );
      }
    } catch (error) {
      console.error("[wecom_kf] Welcome send error:", error);
    }
    return;
  }

  if (eventType === "msg_send_fail") {
    console.warn(
      `[wecom_kf] msg_send_fail: fail_msgid=${failMsgId ?? "unknown"} fail_type=${failType ?? "unknown"}`,
    );
    return;
  }

  console.log(`[wecom_kf] Unhandled system event: ${eventType ?? "unknown"}`);
}
