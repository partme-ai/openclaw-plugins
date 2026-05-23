/**
 * @module dispatch/embedded-dispatch
 *
 * embedded-agent dispatch：当前进程内 runEmbeddedAgent → wire 序列化 → deliver。
 *
 * **职责**：在 wire 通道上以 embedded 模式同步运行 Agent，将最终文本序列化并通过 deliver 回传。
 *
 * **关键导出**：`dispatchEmbeddedAgentMessage`
 */

import { serializeForTransport, type OutboundWireFormat } from "../pipeline/serialize-payload.js";
import type { ReplyRoute } from "../core/types.js";
import {
  createDispatchRunId,
  extractFinalTextFromRunResult,
  sanitizeSessionId,
} from "./agent-helpers.js";
import type { EmbeddedAgentDispatchParams, EmbeddedAgentRuntime } from "./types.js";

/**
 * 通过 embedded agent 执行 prompt 并将回复经 deliver 发回传输层 / Run embedded agent and deliver reply.
 *
 * @param params - Embedded runtime、通道身份、prompt、reply 配置
 * @returns runId 与是否已成功 deliver（空回复时 delivered=false）
 */
export async function dispatchEmbeddedAgentMessage(
  params: EmbeddedAgentDispatchParams,
): Promise<{ runId: string; delivered: boolean }> {
  const rt = params.runtime as EmbeddedAgentRuntime;
  const cfg = rt.config;
  const runId = params.runId ?? createDispatchRunId();
  const sessionId =
    params.sessionId ??
    `${params.channel}:${params.accountId}:${params.agentId}:${params.peerId}`;

  const agentDir = await rt.agent.resolveAgentDir(cfg, params.agentId);
  const workspaceDir = rt.agent.resolveAgentWorkspaceDir(cfg, params.agentId);
  const sessionFile = `${agentDir}/sessions/${sanitizeSessionId(sessionId)}.jsonl`;

  const result = await rt.agent.runEmbeddedAgent({
    sessionId,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    sessionFile,
    workspaceDir,
    prompt: params.text,
    timeoutMs: params.timeoutMs ?? 120_000,
    runId,
    config: cfg,
  });

  const replyText = extractFinalTextFromRunResult(result);
  if (replyText.trim().length === 0) {
    return { runId, delivered: false };
  }

  const format: OutboundWireFormat = params.reply.outboundFormat ?? "legacyJsonText";
  const wire = serializeForTransport({
    channel: params.channel,
    accountId: params.accountId,
    userId: params.reply.userId ?? params.sessionKey,
    text: replyText,
    agentId: params.agentId,
    format,
    replyRoute: params.reply.replyRoute as ReplyRoute | undefined,
  });

  await params.reply.deliver({ wire, text: replyText, runId });
  return { runId, delivered: true };
}
