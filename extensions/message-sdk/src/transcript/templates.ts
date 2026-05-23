/**
 * @module transcript/templates
 *
 * Transcript 用户可见模板解析与错误/超时摘要构造。
 *
 * **职责**：合并默认/overrides 模板、解析 tool 状态行、生成耗时脚注、
 * 以及 dispatch / media / timeout 等异常场景的用户可见摘要。
 *
 * **适用场景**：流式回复状态行更新、关流兜底、onError 用户提示。
 *
 * **上下游**：
 * - 上游：渠道默认模板 + 用户 *Text 配置
 * - 下游：`finish-stream`、`reply-dispatcher-factory`、`syncStreamContent`
 *
 * **关键导出**：`resolveChannelTemplates`、`resolveToolStatusLine`、`formatElapsedFooter` 等
 */

import { formatTemplate } from "../util/format-template.js";

/**
 * 合并默认模板与 overrides（trim 后非空才覆盖）。
 *
 * @typeParam T - 模板键记录类型
 * @param defaults - 默认模板
 * @param overrides - 可选覆盖项（通常来自 resolveChannelUserTexts）
 * @returns 合并后的模板对象
 */
export function resolveChannelTemplates<T extends Record<string, string>>(
  defaults: T,
  overrides: Partial<Record<keyof T & string, string | undefined>> = {},
): T {
  const resolved = { ...defaults };
  for (const key of Object.keys(defaults) as Array<keyof T & string>) {
    const custom = overrides[key]?.trim();
    if (custom) {
      resolved[key] = custom as T[keyof T & string];
    }
  }
  return resolved;
}

/**
 * 解析 tool 阶段状态文案。
 *
 * 模板含 `{toolName}` 且传入工具名时做占位替换。
 *
 * @param toolTemplate - tool 状态模板
 * @param toolName - 当前工具名（可选）
 * @returns 用户可见状态行
 */
export function resolveToolStatusLine(toolTemplate: string, toolName?: string): string {
  if (toolName && toolTemplate.includes("{toolName}")) {
    return formatTemplate(toolTemplate, { toolName });
  }
  return toolTemplate;
}

/**
 * 根据耗时毫秒生成关流脚注。
 *
 * @param elapsedMs - 回复耗时（毫秒）
 * @param finishFooterTemplate - 脚注模板（含 `{elapsed}` 占位，单位为秒）
 * @returns 格式化后的脚注行
 */
export function formatElapsedFooter(
  elapsedMs: number,
  finishFooterTemplate: string,
): string {
  const seconds = Math.max(1, Math.round(elapsedMs / 1000));
  return formatTemplate(finishFooterTemplate, { elapsed: seconds });
}

/**
 * 构建 Agent 回复超时时的用户可见摘要。
 *
 * @param timeoutMs - 超时阈值（毫秒）
 * @param timeoutTemplate - 超时模板（含 `{minutes}` 占位）
 * @returns 用户可见超时提示
 */
export function buildAgentReplyTimeoutSummary(
  timeoutMs: number,
  timeoutTemplate: string,
): string {
  const minutes = Math.max(1, Math.round(timeoutMs / 60_000));
  return formatTemplate(timeoutTemplate, { minutes });
}

/**
 * 构建 dispatch onError 时的用户可见摘要（截断过长错误）。
 *
 * @param kind - 错误类别标识（如 media、reply）
 * @param err - 原始错误
 * @param dispatchErrorTemplate - 错误模板（含 `{kind}`、`{detail}`）
 * @param maxLen - detail 最大长度，默认 200
 * @returns 用户可见错误摘要
 */
export function buildDispatchErrorSummary(
  kind: string,
  err: unknown,
  dispatchErrorTemplate: string,
  maxLen = 200,
): string {
  const raw = String(err).replace(/\s+/g, " ").trim();
  const detail = raw.length > maxLen ? `${raw.slice(0, maxLen)}…` : raw;
  return formatTemplate(dispatchErrorTemplate, {
    kind,
    detail: detail || "未知错误",
  });
}

/**
 * 根据媒体发送结果生成纯文本错误摘要。
 *
 * @param mediaUrl - 媒体 URL（用于占位）
 * @param result - 发送结果（rejectReason / error）
 * @param templates - 分级错误模板
 * @returns 用户可见媒体错误文案
 */
export function buildMediaErrorSummary(
  mediaUrl: string,
  result: { rejectReason?: string; error?: string },
  templates: {
    mediaErrorNoAccess: string;
    mediaErrorReason: string;
    mediaErrorGeneric: string;
  },
): string {
  if (result.error?.includes("LocalMediaAccessError")) {
    return formatTemplate(templates.mediaErrorNoAccess, { mediaUrl });
  }
  if (result.rejectReason) {
    return formatTemplate(templates.mediaErrorReason, { reason: result.rejectReason });
  }
  return formatTemplate(templates.mediaErrorGeneric, { mediaUrl });
}

export { formatTemplate };
