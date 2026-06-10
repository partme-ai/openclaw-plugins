/**
 * @module config/templates
 *
 * KF 用户可见文案模板（超时等），通用逻辑委托 message-sdk transcript。
 *
 * **职责**：内置默认文案、合并 `channels.wecom-kf` 平铺 `*Text` 字段、构建超时摘要。
 *
 * **上下游**：
 * - 上游：账号/渠道级 `timeoutText` 等配置
 * - 下游：`dispatch/inbound-dispatcher.ts` 超时兜底回复
 */

import {
  buildAgentReplyTimeoutSummary as sdkBuildAgentReplyTimeoutSummary,
  resolveChannelUserTexts,
} from "@partme.ai/openclaw-message-sdk/transcript";

/** 解析后的 KF 文案模板（当前仅超时；可随 P2+ 扩展） */
export type ResolvedWecomKfTemplates = {
  timeout: string;
};

/** 内置默认文案（与 wecom 渠道 timeout 模板一致） */
export const WECOM_KF_DEFAULT_TEMPLATES: ResolvedWecomKfTemplates = {
  timeout: "⚠️ 处理超时（约 {minutes} 分钟），请稍后重试或发送文字消息。",
};

const WECOM_KF_TEXT_KEY_MAPPING: {
  [K in keyof ResolvedWecomKfTemplates]: `${K}Text` | "timeoutText";
} = {
  timeout: "timeoutText",
};

/**
 * 合并 `channels.wecom-kf` / 账号级平铺 *Text 字段与默认模板。
 *
 * @param accountOrChannelConfig - 账号或渠道配置对象
 * @returns 完整模板集
 */
export function resolveWecomKfTemplates(
  accountOrChannelConfig?: Record<string, unknown>,
): ResolvedWecomKfTemplates {
  return resolveChannelUserTexts(
    WECOM_KF_DEFAULT_TEMPLATES,
    WECOM_KF_TEXT_KEY_MAPPING,
    accountOrChannelConfig ?? {},
  );
}

/**
 * 构建 Agent 回复超时时的用户可见摘要。
 *
 * @param timeoutMs - 超时阈值（毫秒）
 * @param templates - 文案模板，默认内置
 * @returns 用户可见超时提示
 */
export function buildKfAgentReplyTimeoutSummary(
  timeoutMs: number,
  templates: ResolvedWecomKfTemplates = WECOM_KF_DEFAULT_TEMPLATES,
): string {
  return sdkBuildAgentReplyTimeoutSummary(timeoutMs, templates.timeout);
}
