/**
 * @module dispatch/subagent-dispatch
 *
 * subagent dispatch：独立子 Agent run → waitForRun → wire 序列化 → deliver。
 *
 * **职责**：在 wire 通道上以 subagent 模式运行 prompt，可选等待结果并序列化回传输层。
 *
 * **关键导出**：`dispatchSubagentMessage`
 */

import { serializeForTransport, type OutboundWireFormat } from "../pipeline/serialize-payload.js";
import type { ReplyRoute } from "../core/types.js";
import {
  createDispatchRunId,
  extractSubagentResultText,
  sanitizeSessionId,
} from "./agent-helpers.js";
import type { SubagentDispatchParams, SubagentRuntime } from "./types.js";

/**
 * 通过 subagent 执行 prompt；可选将回复经 deliver 发回传输层 / Run subagent and optionally deliver reply.
 *
 * @param params - Subagent runtime、通道身份、文本、reply 配置
 * @returns runId 与是否已成功 deliver
 */
export async function dispatchSubagentMessage(
  params: SubagentDispatchParams,
): Promise<{ runId: string; delivered: boolean }> {
  const rt = params.runtime as SubagentRuntime;
  const childSessionKey =
    params.childSessionKey ??
    `agent:${params.agentId}:subagent:${params.channel}:${sanitizeSessionId(params.sessionKey)}`;

  const { runId } = await rt.subagent.run({
    sessionKey: childSessionKey,
    message: params.text,
    deliver: false,
  });

  if (params.replyEnabled === false) {
    return { runId, delivered: false };
  }

  const result = await rt.subagent.waitForRun({
    runId,
    timeoutMs: params.timeoutMs ?? 120_000,
  });

  const replyText = extractSubagentResultText(result);
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
