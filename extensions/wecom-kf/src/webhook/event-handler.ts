/**
 * @file WeCom KF 系统事件处理器 —— 欢迎语发送、发送失败处理等。
 *
 * @description 当 origin=4 且 msgtype=event 时被 invoke。
 * - enter_session：可发送 welcomeText 欢迎语
 * - msg_send_fail：记录发送失败日志
 *
 * @module webhook/event-handler
 */

import type { KfMessage } from "../types/message.js";
import type { WecomAccountConfig } from "../types/config.js";

/**
 * 处理 KF 系统事件。
 *
 * @param msg - KF 消息（origin=4）
 * @param accountConfig - 当前账号配置
 */
export async function handleKfSystemEvent(
  msg: KfMessage,
  accountConfig: WecomAccountConfig,
): Promise<void> {
  const event = msg.event as string | undefined;
  if (!event) return;

  if (event === "enter_session") {
    await handleEnterSession(msg, accountConfig);
  } else if (event === "msg_send_fail") {
    await handleMsgSendFail(msg, accountConfig);
  }
}

async function handleEnterSession(
  msg: KfMessage,
  accountConfig: WecomAccountConfig,
): Promise<void> {
  const welcomeText = accountConfig.welcomeText?.trim();
  if (!welcomeText) return;

  // Enter session 事件不含 external_userid，需从 event 数据中获取
  // 此处通过 sendKfWelcomeMessage API 发送欢迎语
  // 实际发送由 onKfCustomerInbound 或 runtime 的 welcome 机制处理
  const kfConfig = accountConfig;
  const corpSecret = kfConfig.corpSecret?.trim();
  if (!corpSecret) return;

  // 通过 event 中的 welcome_code 发送欢迎语需要在 webhook 层处理，
  // 此处记录日志供调用方参考
  console.log(
    `[wecom_kf] enter_session open_kfid=${msg.open_kfid ?? "unknown"} welcomeText configured: ${welcomeText.slice(0, 40)}`,
  );
  // 欢迎语的发送依赖 sync_msg 中返回的 welcome_code，由 processKfEvent 的 callback 路径处理
}

async function handleMsgSendFail(
  msg: KfMessage,
  _accountConfig: WecomAccountConfig,
): Promise<void> {
  const failMsgId = (msg as Record<string, unknown>).fail_msgid as string | undefined;
  console.warn(
    `[wecom_kf] msg_send_fail: msgid=${msg.msgid ?? "unknown"}, fail_msgid=${failMsgId ?? "unknown"}`,
  );
}
