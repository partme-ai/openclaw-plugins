/**
 * embedded-agent / subagent dispatch 共用工具。
 */

import { randomUUID } from "node:crypto";

/**
 * 从 embedded agent run 结果中提取可发送文本。
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
 * 规范化 session 文件名片段。
 */
export function sanitizeSessionId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._:-]+/g, "_").slice(0, 128);
}

/**
 * 生成 run / correlation 标识。
 */
export function createDispatchRunId(): string {
  return randomUUID();
}

/**
 * 从 subagent waitForRun 结果提取文本。
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
