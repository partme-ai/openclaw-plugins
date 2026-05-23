/**
 * @module group-policy
 *
 * 企业微信群聊访问控制 — message-sdk 薄封装。
 *
 * **职责**：根据 `groupPolicy`（open / allowlist / disabled）及 per-group 配置
 * （`groups[chatId].allowFrom` / `requireMention` 等）判定群消息是否放行。
 *
 * **适用场景**：WS / Webhook 入站链路在 DM 策略之前，仅对 `chattype === group` 调用。
 *
 * **上下游**：
 * - 上游：`@partme.ai/openclaw-message-sdk/ingress` `checkChannelGroupPolicy`
 * - 下游：monitor 消息继续处理或静默丢弃
 *
 * **关键导出**：`checkGroupPolicy`、`isSenderAllowed`
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import {
  checkChannelGroupPolicy,
  isSenderInAllowlist as sdkIsSenderInAllowlist,
  type GroupPolicyCheckResult,
} from "@partme.ai/openclaw-message-sdk/ingress";
import { CHANNEL_ID } from "../types/const.js";
import type { ResolvedWeComAccount, WeComConfig, WeComGroupConfig } from "./wecom-config.js";

export type { GroupPolicyCheckResult };
export type { WeComGroupConfig };

/**
 * 检查群组策略访问控制。
 *
 * @param params.chatId - 群 chatid
 * @param params.senderId - 发送者 userid
 * @param params.account - 已解析账号（含 groupPolicy / groups）
 * @param params.config - OpenClaw 全局配置
 * @param params.runtime - 运行时日志
 * @returns 是否允许处理该群消息
 */
export function checkGroupPolicy(params: {
  chatId: string;
  senderId: string;
  account: ResolvedWeComAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
}): GroupPolicyCheckResult {
  return checkChannelGroupPolicy({
    channelId: CHANNEL_ID,
    chatId: params.chatId,
    senderId: params.senderId,
    channelConfig: params.account.config,
    runtime: params.runtime,
    logPrefix: "[WeCom]",
  });
}

/**
 * 检查发送者是否在 allowFrom 白名单中（通用工具）。
 *
 * @param senderId - 发送者 ID
 * @param allowFrom - 白名单条目（可含 `wecom:` 前缀）
 * @returns 是否匹配
 */
export function isSenderAllowed(senderId: string, allowFrom: string[]): boolean {
  return sdkIsSenderInAllowlist(senderId, allowFrom, CHANNEL_ID);
}
