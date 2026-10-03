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
import type { AgentWaitResult, SubagentOutcome } from "./types.js";

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
 *
 * @returns UUID v4 字符串
 */
export function createDispatchRunId(): string {
  return randomUUID();
}

/**
 * 依据宿主公开的 waitForRun 终态区分可见回复、无回复及失败。
 *
 * @param result - waitForRun 返回值；运行边界可能传入未知结构，须先校验。
 * @returns 结构化终态，未知结构按 invalid 失败处理。
 */
export function resolveSubagentOutcome(result: AgentWaitResult): SubagentOutcome;
export function resolveSubagentOutcome(result: unknown): SubagentOutcome;
export function resolveSubagentOutcome(result: unknown): SubagentOutcome {
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    return { kind: "failed", status: "invalid" };
  }
  const value = result as Record<string, unknown>;
  if (value.status === "pending") return { kind: "pending" };
  if (value.status === "timeout" || value.status === "error") {
    return { kind: "failed", status: value.status };
  }
  if (value.status !== "ok") return { kind: "failed", status: "invalid" };

  const reply = value.terminalReply;
  if (reply === null || typeof reply !== "object" || Array.isArray(reply)) {
    return { kind: "failed", status: "invalid" };
  }
  const terminal = reply as Record<string, unknown>;
  if (terminal.disposition === "silent") return { kind: "silent" };
  if (terminal.disposition === "empty") return { kind: "empty" };
  if (terminal.disposition === "visible" && typeof terminal.text === "string") {
    return terminal.text.trim().length > 0
      ? { kind: "visible", text: terminal.text }
      : { kind: "empty" };
  }
  return { kind: "failed", status: "invalid" };
}

/** 保留既有文本提取 API；仅返回明确可见的正文。 */
export function extractSubagentResultText(result: unknown): string {
  const outcome = resolveSubagentOutcome(result);
  return outcome.kind === "visible" ? outcome.text : "";
}
