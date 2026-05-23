/**
 * @module dispatch/agent-helpers
 *
 * embedded-agent / subagent dispatch 共用工具。
 *
 * **职责**：从 run 结果提取可发送文本、规范化 session 文件名片段、生成 runId。
 *
 * **关键导出**：`extractFinalTextFromRunResult`、`extractSubagentResultText`、`sanitizeSessionId`
 */

import { randomUUID } from "node:crypto";

/**
 * 从 embedded agent run 结果中提取可发送文本 / Extract sendable text from embedded run result.
 *
 * 过滤 isReasoning=true 的 payload，拼接非 reasoning 文本块。
 *
 * @param result - runEmbeddedAgent 返回值
 * @returns 拼接后的回复文本
 */
export function extractFinalTextFromRunResult(result: unknown): string {
  const payloads = Array.isArray((result as { payloads?: unknown[] })?.payloads)
    ? ((result as { payloads: unknown[] }).payloads ?? [])
    : [];
  const texts = payloads
    .filter(
      (p): p is { text: string; isReasoning?: boolean } =>
        !!p &&
        typeof p === "object" &&
        typeof (p as { text?: unknown }).text === "string" &&
        (p as { isReasoning?: boolean }).isReasoning !== true,
    )
    .map((p) => p.text);
  return texts.join("\n");
}

/**
 * 规范化 session 文件名片段（仅保留安全字符，最长 128）/ Sanitize session id for file names.
 *
 * @param id - 原始 session 标识
 * @returns 可用于文件路径的安全片段
 */
export function sanitizeSessionId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._:-]+/g, "_").slice(0, 128);
}

/**
 * 生成 run / correlation 标识 / Generate a UUID run id.
 */
export function createDispatchRunId(): string {
  return randomUUID();
}

/**
 * 从 subagent waitForRun 结果提取文本 / Extract text from subagent waitForRun result.
 *
 * 依次尝试 result.text、result.message，否则 JSON.stringify。
 *
 * @param result - waitForRun 返回值
 */
export function extractSubagentResultText(result: unknown): string {
  if (typeof (result as { text?: unknown })?.text === "string") {
    return (result as { text: string }).text;
  }
  if (typeof (result as { message?: unknown })?.message === "string") {
    return (result as { message: string }).message;
  }
  return JSON.stringify(result ?? {});
}
