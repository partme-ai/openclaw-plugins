/**
 * Session 指标采集器
 *
 * 数据来源：Gateway `sessions.list` RPC 方法
 * sessions.list 返回所有会话条目，每个条目包含：
 * - sessionId、key、updatedAt
 * - inputTokens、outputTokens、totalTokens、contextTokens
 * - channel、origin 信息
 *
 * 从真实数据中提取：
 * - 会话总数、按渠道分布
 * - Token 消耗聚合（input/output/total/context）
 * - 最近活跃会话数
 * - 平均/最大 Token 使用量
 */

import type { MetricCollector, MetricDefinition, MetricSample, SessionEntry } from "../types.js";
import { rpcCall } from "../ws-bridge.js";
import { sanitizeLabel } from "../utils.js";

const PREFIX = "openclaw_session";
const SESSIONS_LIST_PARAMS = {
  includeGlobal: true,
  includeUnknown: false,
  limit: 120,
} as const;

/**
 * Session 采集器
 * 调用 Gateway `sessions.list` RPC，聚合会话统计
 */
export class SessionCollector implements MetricCollector {
  name = "sessions";

  definitions: MetricDefinition[] = [
    { name: `${PREFIX}_total`, help: "Total sessions in store", type: "gauge" },
    { name: `${PREFIX}_active_recent`, help: "Sessions active in last 30 minutes", type: "gauge" },
    { name: `${PREFIX}_by_channel`, help: "Sessions per channel", type: "gauge", labels: ["channel"] },
    { name: `${PREFIX}_tokens_input_total`, help: "Total input tokens across all sessions", type: "gauge" },
    { name: `${PREFIX}_tokens_output_total`, help: "Total output tokens across all sessions", type: "gauge" },
    { name: `${PREFIX}_tokens_total`, help: "Total tokens (input+output) across all sessions", type: "gauge" },
    { name: `${PREFIX}_tokens_context_total`, help: "Total context tokens across active sessions", type: "gauge" },
    { name: `${PREFIX}_estimated_cost_usd_total`, help: "Estimated session cost across listed sessions", type: "gauge" },
    { name: `${PREFIX}_tokens_avg_per_session`, help: "Average total tokens per session", type: "gauge" },
    { name: `${PREFIX}_tokens_max_per_session`, help: "Max total tokens in a single session", type: "gauge" },
  ];

  /**
   * 采集 Session 指标
   * 调用 sessions.list 并从真实会话数据中聚合
   */
  async collect(): Promise<MetricSample[]> {
    const result = await rpcCall<unknown>("sessions.list", SESSIONS_LIST_PARAMS);
    const sessions = normalizeSessions(result);
    const resultObj = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
    const samples: MetricSample[] = [];

    samples.push({
      name: `${PREFIX}_total`,
      value: typeof resultObj.count === "number" ? resultObj.count : sessions.length,
    });

    const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
    const recentCount = sessions.filter((s) => typeof s.updatedAt === "number" && s.updatedAt > thirtyMinAgo)
      .length;
    samples.push({ name: `${PREFIX}_active_recent`, value: recentCount });

    const byChannel: Record<string, number> = {};
    let totalInput = 0;
    let totalOutput = 0;
    let totalTokens = 0;
    let totalContext = 0;
    let maxTokens = 0;
    let totalCost = 0;

    for (const session of sessions) {
      const channel = sanitizeLabel(
        session.channel ??
          session.origin?.label ??
          session.origin?.provider ??
          (typeof session.subject === "string" && session.subject ? session.subject : "unknown"),
      );
      byChannel[channel] = (byChannel[channel] ?? 0) + 1;

      const input = numberValue(session.inputTokens);
      const output = numberValue(session.outputTokens);
      const total = numberValue(session.totalTokens) || input + output;
      const context = numberValue(session.contextTokens);
      const estimatedCost = numberValue((session as Record<string, unknown>).estimatedCostUsd);

      totalInput += input;
      totalOutput += output;
      totalTokens += total;
      totalContext += context;
      totalCost += estimatedCost;
      if (total > maxTokens) {
        maxTokens = total;
      }
    }

    for (const [channel, count] of Object.entries(byChannel)) {
      samples.push({ name: `${PREFIX}_by_channel`, labels: { channel }, value: count });
    }

    samples.push({ name: `${PREFIX}_tokens_input_total`, value: totalInput });
    samples.push({ name: `${PREFIX}_tokens_output_total`, value: totalOutput });
    samples.push({ name: `${PREFIX}_tokens_total`, value: totalTokens });
    samples.push({ name: `${PREFIX}_tokens_context_total`, value: totalContext });
    samples.push({ name: `${PREFIX}_estimated_cost_usd_total`, value: totalCost });
    samples.push({
      name: `${PREFIX}_tokens_avg_per_session`,
      value: sessions.length > 0 ? Math.round(totalTokens / sessions.length) : 0,
    });
    samples.push({ name: `${PREFIX}_tokens_max_per_session`, value: maxTokens });

    return samples;
  }
}

function normalizeSessions(result: unknown): SessionEntry[] {
  if (Array.isArray(result)) {
    return result as SessionEntry[];
  }
  if (result && typeof result === "object") {
    const obj = result as Record<string, unknown>;
    if (Array.isArray(obj.sessions)) {
      return obj.sessions as SessionEntry[];
    }
    if (Array.isArray(obj.entries)) {
      return obj.entries as SessionEntry[];
    }
  }
  return [];
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
