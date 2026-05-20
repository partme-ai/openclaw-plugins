/**
 * 系统事件处理器
 * 处理企微客服系统事件：进入会话、会话状态变更、消息发送失败等
 * 欢迎语/结束语/满意度通过 kf/send_msg_on_event 发送，文档 95122
 * NOTE: This module is incomplete - required API functions not yet implemented
 */

import type { KfMessage, WecomAccountConfig } from "../types/index.js";
import { getAccessToken } from "./api-client.js";
// import { getEventMessagesConfig } from "../config/event-messages.js";
// import { cacheServicers } from "../config/accounts.js";

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
  // TODO: Implement system event handling
  // Required API functions not yet implemented:
  // - sendEventMessage (for welcome messages, satisfaction surveys)
  // - listServicers (for servicer cache management)
  // - getEventMessagesConfig (for event message configuration)
  throw new Error("System event handling not yet implemented for wecom-kf plugin");
}
