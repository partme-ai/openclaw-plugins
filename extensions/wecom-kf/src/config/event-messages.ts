/**
 * 事件消息配置读取
 * 欢迎语、结束语、满意度等，支持渠道级默认 + 账号级覆盖
 * 与 wecom 插件 config 分层一致
 */

import type { EventMessagesConfig } from "../types/index.js";
import { getWecomRuntime } from "../runtime.js";

/** 内置默认事件消息配置 */
const DEFAULT_EVENT_MESSAGES: EventMessagesConfig = {
  welcome: {
    enabled: true,
    msgtype: "text",
    content: { text: { content: "您好！我是 AI 智能客服，有什么可以帮您？" } },
  },
  ending: {
    enabled: false,
    msgtype: "text",
    content: { text: { content: "感谢您的咨询，祝您生活愉快！" } },
  },
  satisfaction: {
    enabled: true,
    head_content: "感谢咨询！请对本次服务评价：",
    options: [
      { id: "sat_good", content: "😊 满意" },
      { id: "sat_bad", content: "😞 不满意" },
    ],
  },
};

/**
 * 获取事件消息配置
 * 优先级：账号级 > 渠道级 > 默认
 *
 * @param openKfId - 客服账号 ID
 * @returns 合并后的事件消息配置
 */
export async function getEventMessagesConfig(
  openKfId: string
): Promise<EventMessagesConfig> {
  try {
    const runtime = getWecomRuntime();
    const cfg = runtime.config;
    const channelCfg = (cfg as unknown as Record<string, Record<string, unknown>>).channels?.[
      "wecom-kf"
    ] as Record<string, unknown> | undefined;

    if (!channelCfg) {
      return DEFAULT_EVENT_MESSAGES;
    }

    const channelEventMessages = channelCfg.eventMessages as
      | EventMessagesConfig
      | undefined;
    const accounts = channelCfg.accounts as
      | Record<string, Record<string, unknown>>
      | undefined;
    const accountCfg = accounts?.[openKfId];
    const accountEventMessages = accountCfg?.eventMessages as
      | EventMessagesConfig
      | undefined;

    return mergeEventMessages(
      DEFAULT_EVENT_MESSAGES,
      channelEventMessages,
      accountEventMessages
    );
  } catch {
    return DEFAULT_EVENT_MESSAGES;
  }
}

/**
 * 合并事件消息配置（浅合并）
 */
function mergeEventMessages(
  defaults: EventMessagesConfig,
  channelLevel?: EventMessagesConfig,
  accountLevel?: EventMessagesConfig
): EventMessagesConfig {
  return {
    welcome: accountLevel?.welcome ?? channelLevel?.welcome ?? defaults.welcome,
    ending: accountLevel?.ending ?? channelLevel?.ending ?? defaults.ending,
    satisfaction:
      accountLevel?.satisfaction ??
      channelLevel?.satisfaction ??
      defaults.satisfaction,
  };
}

/**
 * 获取默认事件消息配置
 */
export function getDefaultEventMessages(): EventMessagesConfig {
  return { ...DEFAULT_EVENT_MESSAGES };
}
