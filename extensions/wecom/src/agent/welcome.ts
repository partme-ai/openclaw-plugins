/**
 * @module agent/welcome
 *
 * Agent 模式 **欢迎语**（enter_chat / subscribe 事件）。
 *
 * **职责**：
 * - 监听 event 类型回调中的 enter_chat、subscribe
 * - 通过 Agent API 向用户发送配置的 welcomeText
 *
 * **上下游**：
 * - 上游：`agent/handler` 在 dedup 后、process 前触发
 * - 配置：`streaming-config.resolveAgentWelcomeText`
 */

import type { ResolvedAgentAccount } from "../types/index.js";
import type { WeComConfig } from "../config/wecom-config.js";
import { resolveAgentWelcomeText } from "../config/streaming-config.js";
import { sendText } from "./api-client.js";

/**
 * 向用户发送欢迎消息。
 *
 * @param account - Agent 账号
 * @param userId - 目标用户 userid
 * @param options.channelConfig - 可选合并的渠道级配置（共享 welcomeText）
 */
export async function sendWelcomeMessage(
  account: ResolvedAgentAccount,
  userId: string,
  options?: { channelConfig?: WeComConfig },
): Promise<void> {
  const text = resolveAgentWelcomeText(account.config.welcomeText, options?.channelConfig);
  if (!text) {
    return;
  }

  try {
    await sendText({
      agent: account,
      toUser: userId,
      text,
    });
  } catch (error) {
    // userid 可能直接映射企业成员身份，异常日志不得回显目标标识。
    console.error(`[wecom-agent] Failed to send welcome message (accountId=${account.accountId}):`, error);
    throw error;
  }
}

/**
 * 判断 event 类型是否应触发欢迎语。
 *
 * @param eventType - 企微 Event 字段（小写）
 */
export function shouldSendWelcome(eventType: string): boolean {
  return eventType === "enter_chat" || eventType === "subscribe";
}
