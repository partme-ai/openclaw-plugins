/**
 * 系统事件处理器
 * 处理企微客服系统事件：进入会话、会话状态变更、消息发送失败等
 * 欢迎语/结束语/满意度通过 kf/send_msg_on_event 发送，文档 95122
 */

import type { KfMessage, WecomAccountConfig } from "../types/index.js";
import { getAccessToken, sendEventMessage, listServicers } from "./api-client.js";
import { getEventMessagesConfig } from "../config/event-messages.js";
import { cacheServicers } from "../config/accounts.js";

/**
 * 处理系统事件
 * origin=4 且 msgtype="event" 的消息进入此函数
 *
 * @param msg - 企微客服消息（系统事件）
 * @param accountConfig - 对应客服账号配置
 */
export async function handleSystemEvent(
  msg: KfMessage,
  accountConfig: WecomAccountConfig
): Promise<void> {
  const event = msg.event;
  if (!event) return;

  const openKfId = msg.open_kfid;

  const eventMsgCfg = await getEventMessagesConfig(openKfId);
  const accessToken = await getAccessToken(
    accountConfig.corpId,
    accountConfig.corpSecret
  );

  switch (event.event_type) {
    case "enter_session":
      await handleEnterSession(accessToken, event, eventMsgCfg);
      break;

    case "session_status_change":
      await handleSessionStatusChange(accessToken, event, eventMsgCfg);
      break;

    case "msg_send_fail":
      handleMsgSendFail(event);
      break;

    case "servicer_status_change":
      await handleServicerStatusChange(accessToken, event, openKfId);
      break;

    default:
      console.log(
        `[wecom_kf] Unknown event type: ${event.event_type}`
      );
  }
}

/**
 * 处理客户进入会话事件
 * welcome_code 有效期仅 20 秒，需立即发送欢迎语
 */
async function handleEnterSession(
  accessToken: string,
  event: NonNullable<KfMessage["event"]>,
  eventMsgCfg: Awaited<ReturnType<typeof getEventMessagesConfig>>
): Promise<void> {
  if (event.welcome_code && eventMsgCfg.welcome?.enabled) {
    try {
      await sendEventMessage(accessToken, event.welcome_code, eventMsgCfg.welcome.msgtype, {
        ...eventMsgCfg.welcome.content,
      });
      console.log("[wecom_kf] Welcome message sent");
    } catch (error) {
      console.error("[wecom_kf] Failed to send welcome message:", error);
    }
  }

  if (event.scene) {
    console.log(
      `[wecom_kf] Customer entered from scene: ${event.scene}` +
        (event.scene_param ? `, param: ${event.scene_param}` : "")
    );
  }

  if (event.wechat_channels) {
    console.log(
      `[wecom_kf] Customer from WeChat Channels: ${event.wechat_channels.nickname}`
    );
  }
}

/**
 * 处理会话状态变更事件
 * change_type: 1=从接待池接入, 2=转接, 3=结束, 4=重新接入
 */
async function handleSessionStatusChange(
  accessToken: string,
  event: NonNullable<KfMessage["event"]>,
  eventMsgCfg: Awaited<ReturnType<typeof getEventMessagesConfig>>
): Promise<void> {
  switch (event.change_type) {
    case 3: {
      if (event.msg_code && eventMsgCfg.satisfaction?.enabled) {
        try {
          await sendEventMessage(accessToken, event.msg_code, "msgmenu", {
            msgmenu: {
              head_content: eventMsgCfg.satisfaction.head_content,
              list: eventMsgCfg.satisfaction.options.map((opt) => ({
                type: "click",
                click: { id: opt.id, content: opt.content },
              })),
            },
          });
          console.log("[wecom_kf] Satisfaction survey sent");
        } catch (error) {
          console.error("[wecom_kf] Failed to send satisfaction survey:", error);
        }
      }
      break;
    }

    case 1:
      console.log("[wecom_kf] Session accepted from pool");
      break;

    case 2:
      console.log("[wecom_kf] Session transferred");
      break;

    case 4:
      console.log("[wecom_kf] Session re-accepted");
      break;

    default:
      console.log(
        `[wecom_kf] Unknown session change type: ${event.change_type}`
      );
  }
}

/**
 * 处理消息发送失败事件
 * fail_type: 4=会话已过期, 5=已关闭, 6=超过5条, 10=用户拒收, 12=禁发类型
 */
function handleMsgSendFail(
  event: NonNullable<KfMessage["event"]>
): void {
  const failMessages: Record<number, string> = {
    4: "会话已过期",
    5: "会话已关闭",
    6: "超过 5 条消息限制",
    10: "用户拒收",
    12: "禁发消息类型",
  };

  const failDesc = failMessages[event.fail_type ?? 0] ?? `未知类型 (${event.fail_type})`;
  console.warn(`[wecom_kf] 消息发送失败: ${failDesc}`);
}

/**
 * 处理接待人员状态变更事件
 * 重新拉取该客服账号的接待人员列表并刷新缓存
 */
async function handleServicerStatusChange(
  accessToken: string,
  event: NonNullable<KfMessage["event"]>,
  openKfId: string
): Promise<void> {
  const statusMap: Record<number, string> = {
    1: "接待中",
    2: "停止接待",
  };
  const statusDesc = statusMap[event.servicer_status ?? 0] ?? `未知 (${event.servicer_status})`;
  console.log(
    `[wecom_kf] Servicer status changed: ${event.servicer_userid ?? "unknown"} → ${statusDesc}`
  );

  try {
    const servicers = await listServicers(accessToken, openKfId);
    cacheServicers(openKfId, servicers);
    const onlineCount = servicers.filter((s) => s.status === 0).length;
    console.log(
      `[wecom_kf] Servicer cache refreshed for ${openKfId}, ` +
        `total: ${servicers.length}, online: ${onlineCount}`
    );
  } catch (error) {
    console.error(
      `[wecom_kf] Failed to refresh servicer cache for ${openKfId}:`,
      error
    );
  }
}
