/**
 * 系统事件处理器
 * 处理企微客服系统事件：进入会话(enter_session)、消息发送失败(msg_send_fail)等
 * 欢迎语通过 kf/send_msg_on_event 发送，参考企微文档 95122
 */

import type { KfMessage } from "../types/index.js";
import { getAccessToken, sendEventMessage } from "./api-client.js";

/**
 * 处理系统事件
 * origin=4 且 msgtype="event" 的消息进入此函数
 *
 * @param msg - 企微客服消息（系统事件）
 * @param accountConfig - 对应客服账号配置（需含 corpId/corpSecret/welcomeText）
 */
export async function handleSystemEvent(
  msg: KfMessage,
  accountConfig: {
    corpId?: string;
    corpSecret?: string;
    agentId?: number | string;
    welcomeText?: string;
    openKfId?: string;
    [key: string]: unknown;
  }
): Promise<void> {
  const eventType = (msg as Record<string, unknown>).event_type as string | undefined;

  if (eventType === "enter_session") {
    const welcomeCode = (msg as Record<string, unknown>).welcome_code as string | undefined;
    const welcomeText = accountConfig.welcomeText?.trim();

    if (!welcomeCode || !welcomeText) {
      // No welcome code or welcome text configured - nothing to do
      return;
    }

    if (!accountConfig.corpId || !accountConfig.corpSecret) {
      console.error("[wecom_kf] Cannot send welcome: corpId or corpSecret not configured");
      return;
    }

    try {
      const token = await getAccessToken({
        accountId: "kf-event",
        enabled: true,
        configured: true,
        corpId: accountConfig.corpId,
        corpSecret: accountConfig.corpSecret,
        token: "",
        encodingAESKey: "",
        config: {
          corpId: accountConfig.corpId,
          corpSecret: accountConfig.corpSecret,
          token: "",
          encodingAESKey: "",
        },
      });
      const result = await sendEventMessage({
        accessToken: token,
        code: welcomeCode,
        msgtype: "text",
        text: { content: welcomeText },
      });
      if (result.errcode !== 0) {
        console.error(
          `[wecom_kf] Welcome send failed: ${result.errmsg} (errcode=${result.errcode})`
        );
      }
    } catch (error) {
      console.error("[wecom_kf] Welcome send error:", error);
    }
    return;
  }

  if (eventType === "msg_send_fail") {
    const failMsgId = (msg as Record<string, unknown>).fail_msgid as string | undefined;
    const failType = (msg as Record<string, unknown>).fail_type as number | undefined;
    console.warn(
      `[wecom_kf] msg_send_fail: fail_msgid=${failMsgId ?? "unknown"} fail_type=${failType ?? "unknown"}`
    );
    return;
  }

  // Other system events are logged but not processed
  console.log(`[wecom_kf] Unhandled system event: ${eventType ?? "unknown"}`);
}
