/**
 * @module kf/event-message-dispatch
 *
 * 基于 `msg_code` 调用 `send_msg_on_event`（95122）发送排队语 / 结束语 / 满意度。
 */

import type { ResolvedAgentAccount } from "../types/index.js";
import { sendKfWelcomeMessage } from "../agent/api-client.js";
import { getEventMessagesConfig, extractEventMessageText } from "../config/event-messages.js";
import {
  listPendingKfSessionSideEffects,
  markKfSessionSideEffectConsumed,
} from "./session-side-effect-store.js";

const AUDIT_PREFIX = "[wecom_kf:audit]";

/**
 * 按 service_state 选择事件消息类型并发送。
 */
export async function dispatchKfEventMessageByCode(params: {
  agent: ResolvedAgentAccount;
  openKfId: string;
  msgCode: string;
  serviceState: number;
}): Promise<{ ok: boolean; errcode?: number; errmsg?: string; skipped?: boolean }> {
  const msgCode = params.msgCode.trim();
  const openKfId = params.openKfId.trim();
  if (!msgCode || !openKfId) {
    return { ok: false, errmsg: "missing msg_code or open_kfid" };
  }

  const eventMessages = await getEventMessagesConfig(openKfId);

  if (params.serviceState === 2) {
    const queueText = extractEventMessageText(eventMessages.queue);
    if (!queueText) {
      return { ok: true, skipped: true };
    }
    const result = await sendKfWelcomeMessage(params.agent, {
      code: msgCode,
      open_kfid: openKfId,
      msgtype: "text",
      text: { content: queueText },
    });
    console.log(
      `${AUDIT_PREFIX} action=send_event_message kind=queue errcode=${result.errcode}`,
    );
    return { ok: result.errcode === 0, errcode: result.errcode, errmsg: result.errmsg };
  }

  if (params.serviceState === 4) {
    const endingText = extractEventMessageText(eventMessages.ending);
    if (endingText && eventMessages.ending?.enabled !== false) {
      const endingResult = await sendKfWelcomeMessage(params.agent, {
        code: msgCode,
        open_kfid: openKfId,
        msgtype: "text",
        text: { content: endingText },
      });
      console.log(
        `${AUDIT_PREFIX} action=send_event_message kind=ending errcode=${endingResult.errcode}`,
      );
      if (endingResult.errcode !== 0) {
        return {
          ok: false,
          errcode: endingResult.errcode,
          errmsg: endingResult.errmsg,
        };
      }
    }

    const satisfaction = eventMessages.satisfaction;
    if (satisfaction?.enabled && satisfaction.options?.length) {
      const satResult = await sendKfWelcomeMessage(params.agent, {
        code: msgCode,
        open_kfid: openKfId,
        msgtype: "msgmenu",
        msgmenu: {
          head_content: satisfaction.head_content ?? "请对本次服务评价：",
          list: satisfaction.options.map((opt) => ({
            type: "click",
            click: { id: opt.id, content: opt.content },
          })),
        },
      });
      console.log(
        `${AUDIT_PREFIX} action=send_event_message kind=satisfaction errcode=${satResult.errcode}`,
      );
      return { ok: satResult.errcode === 0, errcode: satResult.errcode, errmsg: satResult.errmsg };
    }

    return { ok: true, skipped: !endingText };
  }

  return { ok: true, skipped: true };
}

/**
 * 消费 SideEffectStore 中 pending 的 msg_code（非阻塞批量）。
 */
export async function consumePendingKfSessionSideEffects(params: {
  agent: ResolvedAgentAccount;
  openKfId?: string;
}): Promise<number> {
  const pending = await listPendingKfSessionSideEffects();
  let sent = 0;

  for (const item of pending) {
    if (params.openKfId && item.openKfId !== params.openKfId.trim()) {
      continue;
    }

    const result = await dispatchKfEventMessageByCode({
      agent: params.agent,
      openKfId: item.openKfId,
      msgCode: item.msgCode,
      serviceState: item.serviceState,
    });

    if (result.ok && !result.skipped) {
      sent += 1;
      await markKfSessionSideEffectConsumed({
        openKfId: item.openKfId,
        externalUserId: item.externalUserId,
        msgCode: item.msgCode,
      });
    } else if (result.skipped) {
      await markKfSessionSideEffectConsumed({
        openKfId: item.openKfId,
        externalUserId: item.externalUserId,
        msgCode: item.msgCode,
      });
    }
  }

  return sent;
}
