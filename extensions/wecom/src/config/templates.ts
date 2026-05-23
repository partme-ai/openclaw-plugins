/**
 * @module templates
 *
 * WeCom 用户可见文案模板（通用逻辑委托 message-sdk transcript）。
 *
 * **职责**：
 * - 定义内置默认文案（thinking / timeout / dispatchError 等）
 * - 合并 `channels.wecom` 平铺 `*Text` 字段与默认值
 * - 构建超时、dispatch 错误、媒体错误等用户可见摘要
 *
 * **适用场景**：WS / Webhook reply pipeline 状态行更新与错误兜底。
 *
 * **上下游**：
 * - 上游：`text-config.WECOM_TEXT_KEY_MAPPING`、`resolveChannelUserTexts`
 * - 下游：`streaming-config`、`finish-thinking`、`monitor` 超时处理
 *
 * **关键导出**：`resolveWecomTemplates`、`WECOM_DEFAULT_TEMPLATES`、各类 build*Summary
 */

import {
  buildAgentReplyTimeoutSummary as sdkBuildAgentReplyTimeoutSummary,
  buildDispatchErrorSummary as sdkBuildDispatchErrorSummary,
  buildMediaErrorSummary as sdkBuildMediaErrorSummary,
  formatElapsedFooter,
  formatTemplate,
  resolveChannelUserTexts,
  resolveToolStatusLine,
} from "@partme.ai/openclaw-message-sdk/transcript";
import { WECOM_TEXT_KEY_MAPPING } from "./text-config.js";
import type { ResolvedWeComAccount } from "./wecom-config.js";
import type { WeComConfig } from "./wecom-config.js";

/** 解析后的完整模板集（所有键均有非空默认值） */
export type ResolvedWecomTemplates = {
  thinking: string;
  received: string;
  tool: string;
  reading: string;
  generating: string;
  compaction: string;
  emptyReply: string;
  finishFooter: string;
  welcome: string;
  cardSent: string;
  mediaSent: string;
  mediaParseFailed: string;
  mediaDelivered: string;
  processedComplete: string;
  timeout: string;
  dispatchError: string;
  mediaErrorNoAccess: string;
  mediaErrorReason: string;
  mediaErrorGeneric: string;
  queued: string;
  mergedQueued: string;
  mergedDone: string;
  sessionReset: string;
  sessionNew: string;
};

/** 内置默认文案（与历史硬编码行为一致） */
export const WECOM_DEFAULT_TEMPLATES: ResolvedWecomTemplates = {
  thinking: "正在思考…",
  received: "已收到，正在处理…",
  tool: "正在查资料…",
  reading: "正在阅读附件…",
  generating: "正在组织回复…",
  compaction: "📦 正在压缩上下文…",
  emptyReply: "⚠️ 未能生成可展示的回复，请稍后重试或发送文字消息。",
  finishFooter: "⏱ {elapsed}s · 已完成",
  welcome: "",
  cardSent: "📋 卡片消息已发送。",
  mediaSent: "📎 文件已发送，请查收。",
  mediaParseFailed: "⚠️ 未能解析该媒体并生成回复。{emptyReply}",
  mediaDelivered: "✅ 文件已发送。",
  processedComplete: "✅ 已处理完成。",
  timeout: "⚠️ 处理超时（约 {minutes} 分钟），请稍后重试或发送文字消息。",
  dispatchError: "⚠️ 回复生成失败（{kind}）：{detail}",
  mediaErrorNoAccess:
    "⚠️ 文件发送失败：没有权限访问路径 {mediaUrl}\n请在 openclaw.json 的 mediaLocalRoots 中添加该路径的父目录后重启生效。",
  mediaErrorReason: "⚠️ 文件发送失败：{reason}",
  mediaErrorGeneric: "⚠️ 文件发送失败：无法处理文件 {mediaUrl}，请稍后再试。",
  queued: "已收到，已排队处理中...",
  mergedQueued: "已收到，已合并排队处理中...",
  mergedDone: "✅ 已合并处理完成，请查看上一条回复。",
  sessionReset: "✅ 已重置会话。",
  sessionNew: "✅ 已开启新会话。",
};

/**
 * 替换模板中的 `{key}` 占位符；未知占位符保留原样。
 *
 * @param template - 含 `{var}` 的模板字符串
 * @param vars - 占位符键值
 * @returns 替换后的字符串
 */
export function formatWecomTemplate(
  template: string,
  vars: Record<string, string | number | undefined>,
): string {
  return formatTemplate(template, vars);
}

/**
 * 合并 `channels.wecom` 平铺 *Text 字段与 {@link WECOM_DEFAULT_TEMPLATES}。
 *
 * @param accountOrConfig - 已解析账号或裸 WeComConfig
 * @returns 完整模板集
 */
export function resolveWecomTemplates(
  accountOrConfig: ResolvedWeComAccount | WeComConfig,
): ResolvedWecomTemplates {
  const cfg = "config" in accountOrConfig ? accountOrConfig.config : accountOrConfig;
  return resolveChannelUserTexts(
    WECOM_DEFAULT_TEMPLATES,
    WECOM_TEXT_KEY_MAPPING,
    cfg as Record<string, unknown>,
  );
}

/**
 * 解析 tool 阶段状态文案；模板含 `{toolName}` 且传入工具名时替换。
 *
 * @param templates - 已解析模板
 * @param toolName - 工具名称（可选）
 * @returns 状态行文本
 */
export function resolveWecomToolStatusLine(
  templates: ResolvedWecomTemplates,
  toolName?: string,
): string {
  return resolveToolStatusLine(templates.tool, toolName);
}

/**
 * 根据耗时毫秒生成关流脚注（使用 finishFooter 模板）。
 *
 * @param elapsedMs - 处理耗时（毫秒）
 * @param templates - 文案模板，默认内置
 * @returns 脚注文本，如 `⏱ 12s · 已完成`
 */
export function formatWecomElapsedFooter(
  elapsedMs: number,
  templates: ResolvedWecomTemplates = WECOM_DEFAULT_TEMPLATES,
): string {
  return formatElapsedFooter(elapsedMs, templates.finishFooter);
}

/**
 * 构建 Agent 回复超时时的用户可见摘要。
 *
 * @param timeoutMs - 超时阈值（毫秒）
 * @param templates - 文案模板
 * @returns 用户可见超时提示
 */
export function buildAgentReplyTimeoutSummary(
  timeoutMs: number,
  templates: ResolvedWecomTemplates = WECOM_DEFAULT_TEMPLATES,
): string {
  return sdkBuildAgentReplyTimeoutSummary(timeoutMs, templates.timeout);
}

/**
 * 构建 dispatch onError 时的用户可见摘要（截断过长错误）。
 *
 * @param kind - 错误类别标识
 * @param err - 原始错误
 * @param templates - 文案模板
 * @param maxLen - detail 最大长度，默认 200
 * @returns 用户可见错误摘要
 */
export function buildDispatchErrorSummary(
  kind: string,
  err: unknown,
  templates: ResolvedWecomTemplates = WECOM_DEFAULT_TEMPLATES,
  maxLen = 200,
): string {
  return sdkBuildDispatchErrorSummary(kind, err, templates.dispatchError, maxLen);
}

/**
 * 根据媒体发送结果生成纯文本错误摘要。
 *
 * @param mediaUrl - 媒体路径或 URL
 * @param result - 发送结果（rejectReason / error）
 * @param templates - 文案模板
 * @returns 用户可见媒体错误提示
 */
export function buildMediaErrorSummary(
  mediaUrl: string,
  result: { rejectReason?: string; error?: string },
  templates: ResolvedWecomTemplates = WECOM_DEFAULT_TEMPLATES,
): string {
  return sdkBuildMediaErrorSummary(mediaUrl, result, {
    mediaErrorNoAccess: templates.mediaErrorNoAccess,
    mediaErrorReason: templates.mediaErrorReason,
    mediaErrorGeneric: templates.mediaErrorGeneric,
  });
}

/** 空回复兜底文案（与 emptyReply 模板一致） */
export const EMPTY_REPLY_FALLBACK_MESSAGE = WECOM_DEFAULT_TEMPLATES.emptyReply;

export const WECOM_STATUS_RECEIVED = WECOM_DEFAULT_TEMPLATES.received;
export const WECOM_STATUS_THINKING = WECOM_DEFAULT_TEMPLATES.thinking;
export const WECOM_STATUS_TOOL = WECOM_DEFAULT_TEMPLATES.tool;
export const WECOM_STATUS_READING = WECOM_DEFAULT_TEMPLATES.reading;
export const WECOM_STATUS_GENERATING = WECOM_DEFAULT_TEMPLATES.generating;
export const WECOM_STATUS_COMPACTING = WECOM_DEFAULT_TEMPLATES.compaction;
