/**
 * @module webhook/access-policy
 *
 * Webhook 入站**访问控制**适配层（群策略 + DM 策略）。
 *
 * **职责**：在 monitor 入队/调度前调用，拒绝未授权会话；DM pairing 码经 response_url 推送。
 *
 * **与 message-sdk 关系**：复用插件内 `group-policy`、`dm-policy` 领域逻辑，本模块仅做
 * Webhook 场景适配（`streamId` + `sendBotFallbackPromptNow`）。
 *
 * **关键导出**：`checkWebhookGroupPolicy`、`checkWebhookDmPolicy`
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { checkGroupPolicy } from "../config/group-policy.js";
import {
  buildWecomPairingReplyText,
  checkWecomDmPolicy,
  type DmPolicyCheckResult,
} from "../config/dm-policy.js";
import type { ResolvedWeComAccount } from "../config/wecom-config.js";
import { sendBotFallbackPromptNow } from "./active-reply.js";

type WebhookRuntime = {
  log?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
};

/**
 * Webhook Bot 入站群聊策略检查。
 *
 * WHY：群聊需校验 chatId + senderId 是否在 allowlist，与 WS 长连接行为对齐。
 *
 * @param params.chatId - 群聊 ID
 * @param params.senderId - 发送者 userid
 * @param params.account - 解析后的企微账号
 * @param params.config - OpenClaw 全局配置
 * @param params.runtime - 日志运行时
 * @returns 是否允许继续处理
 */
export function checkWebhookGroupPolicy(params: {
  chatId: string;
  senderId: string;
  account: ResolvedWeComAccount;
  config: OpenClawConfig;
  runtime: WebhookRuntime;
}): boolean {
  const result = checkGroupPolicy({
    chatId: params.chatId,
    senderId: params.senderId,
    account: params.account,
    config: params.config,
    runtime: params.runtime as Parameters<typeof checkGroupPolicy>[0]["runtime"],
  });
  if (!result.allowed) {
    params.runtime.log?.(
      `[webhook] group policy blocked chatId=${params.chatId} sender=${params.senderId}`,
    );
  }
  return result.allowed;
}

/**
 * Webhook Bot 入站 DM 策略检查；pairing 码经 `response_url` 主动推送。
 *
 * WHY：Webhook 无 WS 长连接即时回复通道，pairing 必须通过 Bot 流式 finish 帧送达用户。
 *
 * @param params.senderId - 发送者 userid
 * @param params.isGroup - 是否群聊（DM 检查时应为 false）
 * @param params.account - 解析后的企微账号
 * @param params.streamId - 当前 stream（用于绑定 response_url）
 * @param params.runtime - 日志运行时
 * @returns DM 策略检查结果（allowed / pairingSent 等）
 */
export async function checkWebhookDmPolicy(params: {
  senderId: string;
  isGroup: boolean;
  account: ResolvedWeComAccount;
  streamId: string;
  runtime: WebhookRuntime;
}): Promise<DmPolicyCheckResult> {
  return checkWecomDmPolicy({
    senderId: params.senderId,
    isGroup: params.isGroup,
    account: params.account,
    runtime: params.runtime as Parameters<typeof checkWecomDmPolicy>[0]["runtime"],
    logPrefix: "[webhook]",
    sendPairingReply: async ({ senderId, code }) => {
      const text = buildWecomPairingReplyText(senderId, code);
      await sendBotFallbackPromptNow({ streamId: params.streamId, text });
    },
  });
}
