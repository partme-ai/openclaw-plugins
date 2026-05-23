/**
 * WeCom 用户可见文案模板：默认值 + 账号级 overrides + 占位符替换。
 *
 * 配置路径：`channels.wecom.templates.*` 或 `channels.wecom.accounts.{id}.templates.*`
 */

import type { ResolvedWeComAccount } from "./utils.js";
import type { WeComConfig } from "./utils.js";
import type { WecomTemplatesConfig } from "./types/config.js";

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

const TEMPLATE_KEYS = Object.keys(WECOM_DEFAULT_TEMPLATES) as Array<keyof ResolvedWecomTemplates>;

/**
 * 替换模板中的 `{key}` 占位符；未知占位符保留原样。
 */
export function formatWecomTemplate(
  template: string,
  vars: Record<string, string | number | undefined>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key];
    return value != null && value !== "" ? String(value) : match;
  });
}

/**
 * 合并 channels.wecom.templates 与 accounts.{id}.templates，未配置项使用默认值。
 */
export function resolveWecomTemplates(
  accountOrConfig: ResolvedWeComAccount | WeComConfig,
): ResolvedWecomTemplates {
  const cfg = "config" in accountOrConfig ? accountOrConfig.config : accountOrConfig;
  const overrides = cfg.templates ?? {};
  const resolved = { ...WECOM_DEFAULT_TEMPLATES };

  for (const key of TEMPLATE_KEYS) {
    const custom = overrides[key]?.trim();
    if (custom) {
      resolved[key] = custom;
    }
  }

  return resolved;
}

/**
 * 解析 tool 阶段状态文案；模板含 `{toolName}` 且传入工具名时替换。
 */
export function resolveWecomToolStatusLine(
  templates: ResolvedWecomTemplates,
  toolName?: string,
): string {
  if (toolName && templates.tool.includes("{toolName}")) {
    return formatWecomTemplate(templates.tool, { toolName });
  }
  return templates.tool;
}

/**
 * 根据耗时毫秒生成关流脚注（使用 finishFooter 模板）。
 */
export function formatWecomElapsedFooter(
  elapsedMs: number,
  templates: ResolvedWecomTemplates = WECOM_DEFAULT_TEMPLATES,
): string {
  const seconds = Math.max(1, Math.round(elapsedMs / 1000));
  return formatWecomTemplate(templates.finishFooter, { elapsed: seconds });
}

/**
 * 构建 Agent 回复超时时的用户可见摘要。
 */
export function buildAgentReplyTimeoutSummary(
  timeoutMs: number,
  templates: ResolvedWecomTemplates = WECOM_DEFAULT_TEMPLATES,
): string {
  const minutes = Math.max(1, Math.round(timeoutMs / 60_000));
  return formatWecomTemplate(templates.timeout, { minutes });
}

/**
 * 构建 dispatch onError 时的用户可见摘要（截断过长错误）。
 */
export function buildDispatchErrorSummary(
  kind: string,
  err: unknown,
  templates: ResolvedWecomTemplates = WECOM_DEFAULT_TEMPLATES,
  maxLen = 200,
): string {
  const raw = String(err).replace(/\s+/g, " ").trim();
  const detail = raw.length > maxLen ? `${raw.slice(0, maxLen)}…` : raw;
  return formatWecomTemplate(templates.dispatchError, {
    kind,
    detail: detail || "未知错误",
  });
}

/**
 * 根据媒体发送结果生成纯文本错误摘要。
 */
export function buildMediaErrorSummary(
  mediaUrl: string,
  result: { rejectReason?: string; error?: string },
  templates: ResolvedWecomTemplates = WECOM_DEFAULT_TEMPLATES,
): string {
  if (result.error?.includes("LocalMediaAccessError")) {
    return formatWecomTemplate(templates.mediaErrorNoAccess, { mediaUrl });
  }
  if (result.rejectReason) {
    return formatWecomTemplate(templates.mediaErrorReason, { reason: result.rejectReason });
  }
  return formatWecomTemplate(templates.mediaErrorGeneric, { mediaUrl });
}

/** @deprecated 使用 WECOM_DEFAULT_TEMPLATES.emptyReply */
export const EMPTY_REPLY_FALLBACK_MESSAGE = WECOM_DEFAULT_TEMPLATES.emptyReply;

/** 向后兼容：状态栏常量 re-export */
export const WECOM_STATUS_RECEIVED = WECOM_DEFAULT_TEMPLATES.received;
export const WECOM_STATUS_THINKING = WECOM_DEFAULT_TEMPLATES.thinking;
export const WECOM_STATUS_TOOL = WECOM_DEFAULT_TEMPLATES.tool;
export const WECOM_STATUS_READING = WECOM_DEFAULT_TEMPLATES.reading;
export const WECOM_STATUS_GENERATING = WECOM_DEFAULT_TEMPLATES.generating;
export const WECOM_STATUS_COMPACTING = WECOM_DEFAULT_TEMPLATES.compaction;

export type { WecomTemplatesConfig };
