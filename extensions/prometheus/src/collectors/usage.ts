import type { MetricCollector, MetricDefinition, MetricSample } from "../types.js";
import { rpcCall } from "../ws-bridge.js";
import { sanitizeLabel } from "../utils.js";

const PREFIX = "openclaw_usage";

const DEFAULT_USAGE_WINDOW_DAYS = 30;

type CostTotalsShape = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  totalCost?: number;
  count?: number;
  missingCostEntries?: number;
};

type UsageCostDailyEntry = {
  date?: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  totalCost?: number;
  missingCostEntries?: number;
};

type UsageCostResult = Record<string, unknown> & {
  totals?: CostTotalsShape;
  daily?: UsageCostDailyEntry[];
};

type SessionsUsageResult = {
  totals?: CostTotalsShape;
  startDate?: string;
  endDate?: string;
  aggregates?: {
    messages?: {
      total?: number;
      user?: number;
      assistant?: number;
      toolCalls?: number;
      toolResults?: number;
      errors?: number;
    };
    tools?: {
      totalCalls?: number;
      uniqueTools?: number;
      tools?: Array<{ name?: string; count?: number }>;
    };
    byProvider?: Array<{ provider?: string; model?: string; count?: number; totals?: CostTotalsShape }>;
    byModel?: Array<{ provider?: string; model?: string; count?: number; totals?: CostTotalsShape }>;
    byAgent?: Array<{ agentId?: string; totals?: CostTotalsShape }>;
    byChannel?: Array<{ channel?: string; totals?: CostTotalsShape }>;
    latency?: {
      count?: number;
      avgMs?: number;
      p95Ms?: number;
      minMs?: number;
      maxMs?: number;
    };
    daily?: Array<{
      date?: string;
      tokens?: number;
      cost?: number;
      messages?: number;
      toolCalls?: number;
      errors?: number;
    }>;
    dailyLatency?: Array<{
      date?: string;
      count?: number;
      avgMs?: number;
      p95Ms?: number;
      minMs?: number;
      maxMs?: number;
    }>;
    modelDaily?: Array<{
      date?: string;
      provider?: string;
      model?: string;
      count?: number;
      tokens?: number;
      cost?: number;
    }>;
  };
};

/**
 * Usage 采集器
 */
export class UsageCollector implements MetricCollector {
  name = "usage";

  definitions: MetricDefinition[] = [
    def(`${PREFIX}_requests_total`, "Request count when exposed by usage.cost payload"),
    def(`${PREFIX}_tokens_input_total`, "Total input tokens across the active usage window"),
    def(`${PREFIX}_tokens_output_total`, "Total output tokens across the active usage window"),
    def(`${PREFIX}_tokens_cache_read_total`, "Total cache-read tokens across the active usage window"),
    def(`${PREFIX}_tokens_cache_write_total`, "Total cache-write tokens across the active usage window"),
    def(`${PREFIX}_tokens_total`, "Total tokens across the active usage window"),
    def(`${PREFIX}_cost_usd_total`, "Total estimated cost USD across the active usage window"),
    def(`${PREFIX}_missing_cost_entries_total`, "Usage rows without cost metadata in the active usage window"),
    def(`${PREFIX}_messages_total`, "Total message count in sessions.usage aggregates"),
    def(`${PREFIX}_messages_user_total`, "Total user messages in sessions.usage aggregates"),
    def(`${PREFIX}_messages_assistant_total`, "Total assistant messages in sessions.usage aggregates"),
    def(`${PREFIX}_messages_tool_calls_total`, "Total tool-call messages in sessions.usage aggregates"),
    def(`${PREFIX}_messages_tool_results_total`, "Total tool-result messages in sessions.usage aggregates"),
    def(`${PREFIX}_messages_errors_total`, "Total error messages in sessions.usage aggregates"),
    def(`${PREFIX}_tools_total_calls`, "Total tool calls in sessions.usage aggregates"),
    def(`${PREFIX}_tools_unique_total`, "Unique tool count in sessions.usage aggregates"),
    def(`${PREFIX}_latency_count`, "Conversation turn count included in latency aggregate"),
    def(`${PREFIX}_latency_avg_seconds`, "Average conversation latency in seconds"),
    def(`${PREFIX}_latency_p95_seconds`, "P95 conversation latency in seconds"),
    def(`${PREFIX}_latency_min_seconds`, "Minimum conversation latency in seconds"),
    def(`${PREFIX}_latency_max_seconds`, "Maximum conversation latency in seconds"),
    labeledDef(`${PREFIX}_tool_calls_total`, "Tool calls grouped by tool name", ["tool"]),
    labeledDef(`${PREFIX}_provider_requests_total`, "Usage entries grouped by provider", ["provider"]),
    labeledDef(`${PREFIX}_provider_tokens_input_total`, "Input tokens grouped by provider", ["provider"]),
    labeledDef(`${PREFIX}_provider_tokens_output_total`, "Output tokens grouped by provider", ["provider"]),
    labeledDef(`${PREFIX}_provider_tokens_cache_read_total`, "Cache-read tokens grouped by provider", ["provider"]),
    labeledDef(`${PREFIX}_provider_tokens_cache_write_total`, "Cache-write tokens grouped by provider", ["provider"]),
    labeledDef(`${PREFIX}_provider_tokens_total`, "Total tokens grouped by provider", ["provider"]),
    labeledDef(`${PREFIX}_provider_cost_usd_total`, "Estimated cost grouped by provider", ["provider"]),
    labeledDef(`${PREFIX}_provider_missing_cost_entries_total`, "Missing cost entries grouped by provider", ["provider"]),
    labeledDef(`${PREFIX}_model_requests_total`, "Usage entries grouped by provider/model", ["provider", "model"]),
    labeledDef(`${PREFIX}_model_tokens_total`, "Total tokens grouped by provider/model", ["provider", "model"]),
    labeledDef(`${PREFIX}_model_cost_usd_total`, "Estimated cost grouped by provider/model", ["provider", "model"]),
    labeledDef(`${PREFIX}_model_tokens_input_total`, "Input tokens grouped by provider/model", ["provider", "model"]),
    labeledDef(`${PREFIX}_model_tokens_output_total`, "Output tokens grouped by provider/model", ["provider", "model"]),
    labeledDef(`${PREFIX}_model_tokens_cache_read_total`, "Cache-read tokens grouped by provider/model", ["provider", "model"]),
    labeledDef(`${PREFIX}_model_tokens_cache_write_total`, "Cache-write tokens grouped by provider/model", ["provider", "model"]),
    labeledDef(`${PREFIX}_model_missing_cost_entries_total`, "Missing cost entries grouped by provider/model", ["provider", "model"]),
    labeledDef(`${PREFIX}_agent_tokens_total`, "Total tokens grouped by agent", ["agent_id"]),
    labeledDef(`${PREFIX}_agent_cost_usd_total`, "Estimated cost grouped by agent", ["agent_id"]),
    labeledDef(`${PREFIX}_channel_tokens_total`, "Total tokens grouped by channel", ["channel"]),
    labeledDef(`${PREFIX}_channel_cost_usd_total`, "Estimated cost grouped by channel", ["channel"]),
    labeledDef(`${PREFIX}_daily_tokens_total`, "Daily tokens grouped by date", ["date"]),
    labeledDef(`${PREFIX}_daily_cost_usd_total`, "Daily cost grouped by date", ["date"]),
    labeledDef(`${PREFIX}_daily_messages_total`, "Daily messages grouped by date", ["date"]),
    labeledDef(`${PREFIX}_daily_tool_calls_total`, "Daily tool calls grouped by date", ["date"]),
    labeledDef(`${PREFIX}_daily_errors_total`, "Daily errors grouped by date", ["date"]),
    labeledDef(`${PREFIX}_daily_latency_count`, "Daily latency sample count grouped by date", ["date"]),
    labeledDef(`${PREFIX}_daily_latency_avg_seconds`, "Daily average latency grouped by date", ["date"]),
    labeledDef(`${PREFIX}_daily_latency_p95_seconds`, "Daily P95 latency grouped by date", ["date"]),
    labeledDef(`${PREFIX}_daily_latency_min_seconds`, "Daily minimum latency grouped by date", ["date"]),
    labeledDef(`${PREFIX}_daily_latency_max_seconds`, "Daily maximum latency grouped by date", ["date"]),
    labeledDef(`${PREFIX}_model_daily_requests_total`, "Daily provider/model usage entries grouped by date", ["date", "provider", "model"]),
    labeledDef(`${PREFIX}_model_daily_tokens_total`, "Daily provider/model tokens grouped by date", ["date", "provider", "model"]),
    labeledDef(`${PREFIX}_model_daily_cost_usd_total`, "Daily provider/model cost grouped by date", ["date", "provider", "model"]),
  ];

  async collect(): Promise<MetricSample[]> {
    const usageWindow = buildUsageWindowParams();
    const [costResult, sessionsUsageResult] = await Promise.all([
      rpcCall<UsageCostResult>("usage.cost", usageWindow),
      rpcCall<SessionsUsageResult>("sessions.usage", {
        ...usageWindow,
        limit: 1000,
        includeContextWeight: true,
      }),
    ]);
    const samples: MetricSample[] = [];
    const cost = costResult ?? {};
    const totals = normalizeTotals(cost.totals ?? sessionsUsageResult?.totals);

    samples.push({ name: `${PREFIX}_requests_total`, value: extractNumber(cost, "requests", "totalRequests", "count") });
    samples.push({ name: `${PREFIX}_tokens_input_total`, value: totals.input });
    samples.push({ name: `${PREFIX}_tokens_output_total`, value: totals.output });
    samples.push({ name: `${PREFIX}_tokens_cache_read_total`, value: totals.cacheRead });
    samples.push({ name: `${PREFIX}_tokens_cache_write_total`, value: totals.cacheWrite });
    samples.push({ name: `${PREFIX}_tokens_total`, value: totals.totalTokens });
    samples.push({ name: `${PREFIX}_cost_usd_total`, value: totals.totalCost });
    samples.push({ name: `${PREFIX}_missing_cost_entries_total`, value: totals.missingCostEntries });

    appendMessageSamples(samples, sessionsUsageResult?.aggregates?.messages);
    appendToolSamples(samples, sessionsUsageResult?.aggregates?.tools);
    appendLatencySamples(samples, sessionsUsageResult?.aggregates?.latency);
    appendDimensionSamples(samples, `${PREFIX}_provider`, ["provider"], sessionsUsageResult?.aggregates?.byProvider);
    appendDimensionSamples(samples, `${PREFIX}_model`, ["provider", "model"], sessionsUsageResult?.aggregates?.byModel);
    appendAgentSamples(samples, sessionsUsageResult?.aggregates?.byAgent);
    appendChannelSamples(samples, sessionsUsageResult?.aggregates?.byChannel);
    appendDailySamples(samples, cost.daily, sessionsUsageResult?.aggregates?.daily);
    appendDailyLatencySamples(samples, sessionsUsageResult?.aggregates?.dailyLatency);
    appendModelDailySamples(samples, sessionsUsageResult?.aggregates?.modelDaily);
    return samples;
  }
}

function num(v: unknown): number {
  if (typeof v === "number" && !Number.isNaN(v)) {
    return v;
  }
  return 0;
}

function extractNumber(obj: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "number" && !Number.isNaN(val)) {
      return val;
    }
  }
  return 0;
}

function def(name: string, help: string): MetricDefinition {
  return { name, help, type: "gauge" };
}

function labeledDef(name: string, help: string, labels: string[]): MetricDefinition {
  return { name, help, type: "gauge", labels };
}

function normalizeTotals(totals: CostTotalsShape | undefined) {
  const input = num(totals?.input);
  const output = num(totals?.output);
  const cacheRead = num(totals?.cacheRead);
  const cacheWrite = num(totals?.cacheWrite);
  const totalTokens =
    num(totals?.totalTokens) > 0
      ? num(totals?.totalTokens)
      : input + output + cacheRead + cacheWrite;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens,
    totalCost: num(totals?.totalCost),
    missingCostEntries: num(totals?.missingCostEntries),
    count: num(totals?.count),
  };
}

function appendMessageSamples(
  samples: MetricSample[],
  messages:
    | {
        total?: number;
        user?: number;
        assistant?: number;
        toolCalls?: number;
        toolResults?: number;
        errors?: number;
      }
    | undefined,
): void {
  samples.push({ name: `${PREFIX}_messages_total`, value: num(messages?.total) });
  samples.push({ name: `${PREFIX}_messages_user_total`, value: num(messages?.user) });
  samples.push({ name: `${PREFIX}_messages_assistant_total`, value: num(messages?.assistant) });
  samples.push({ name: `${PREFIX}_messages_tool_calls_total`, value: num(messages?.toolCalls) });
  samples.push({ name: `${PREFIX}_messages_tool_results_total`, value: num(messages?.toolResults) });
  samples.push({ name: `${PREFIX}_messages_errors_total`, value: num(messages?.errors) });
}

function appendToolSamples(
  samples: MetricSample[],
  tools:
    | {
        totalCalls?: number;
        uniqueTools?: number;
        tools?: Array<{ name?: string; count?: number }>;
      }
    | undefined,
): void {
  samples.push({ name: `${PREFIX}_tools_total_calls`, value: num(tools?.totalCalls) });
  samples.push({ name: `${PREFIX}_tools_unique_total`, value: num(tools?.uniqueTools) });
  if (!Array.isArray(tools?.tools)) {
    return;
  }
  for (const tool of tools.tools) {
    samples.push({
      name: `${PREFIX}_tool_calls_total`,
      labels: { tool: sanitizeLabel(tool.name || "unknown") },
      value: num(tool.count),
    });
  }
}

function appendLatencySamples(
  samples: MetricSample[],
  latency:
    | {
        count?: number;
        avgMs?: number;
        p95Ms?: number;
        minMs?: number;
        maxMs?: number;
      }
    | undefined,
): void {
  samples.push({ name: `${PREFIX}_latency_count`, value: num(latency?.count) });
  samples.push({ name: `${PREFIX}_latency_avg_seconds`, value: num(latency?.avgMs) / 1000 });
  samples.push({ name: `${PREFIX}_latency_p95_seconds`, value: num(latency?.p95Ms) / 1000 });
  samples.push({ name: `${PREFIX}_latency_min_seconds`, value: num(latency?.minMs) / 1000 });
  samples.push({ name: `${PREFIX}_latency_max_seconds`, value: num(latency?.maxMs) / 1000 });
}

function appendDimensionSamples(
  samples: MetricSample[],
  metricPrefix: string,
  labelKeys: string[],
  rows: Array<{ provider?: string; model?: string; count?: number; totals?: CostTotalsShape }> | undefined,
): void {
  if (!Array.isArray(rows)) {
    return;
  }
  for (const row of rows) {
    const provider = String(row.provider ?? "unknown");
    if (provider === "openclaw") continue;
    const labels: Record<string, string> = {};
    for (const key of labelKeys) {
      labels[key] = sanitizeLabel(String((row as Record<string, unknown>)[key] ?? "unknown"));
    }
    const totals = normalizeTotals(row.totals);
    samples.push({ name: `${metricPrefix}_requests_total`, labels, value: num(row.count) || totals.count });
    samples.push({ name: `${metricPrefix}_tokens_input_total`, labels, value: totals.input });
    samples.push({ name: `${metricPrefix}_tokens_output_total`, labels, value: totals.output });
    samples.push({ name: `${metricPrefix}_tokens_cache_read_total`, labels, value: totals.cacheRead });
    samples.push({ name: `${metricPrefix}_tokens_cache_write_total`, labels, value: totals.cacheWrite });
    samples.push({ name: `${metricPrefix}_tokens_total`, labels, value: totals.totalTokens });
    samples.push({ name: `${metricPrefix}_cost_usd_total`, labels, value: totals.totalCost });
    samples.push({
      name: `${metricPrefix}_missing_cost_entries_total`,
      labels,
      value: totals.missingCostEntries,
    });
  }
}

function appendAgentSamples(
  samples: MetricSample[],
  rows: Array<{ agentId?: string; totals?: CostTotalsShape }> | undefined,
): void {
  if (!Array.isArray(rows)) {
    return;
  }
  for (const row of rows) {
    const labels = { agent_id: sanitizeLabel(row.agentId || "unknown") };
    const totals = normalizeTotals(row.totals);
    samples.push({ name: `${PREFIX}_agent_tokens_total`, labels, value: totals.totalTokens });
    samples.push({ name: `${PREFIX}_agent_cost_usd_total`, labels, value: totals.totalCost });
  }
}

function appendChannelSamples(
  samples: MetricSample[],
  rows: Array<{ channel?: string; totals?: CostTotalsShape }> | undefined,
): void {
  if (!Array.isArray(rows)) {
    return;
  }
  for (const row of rows) {
    const labels = { channel: sanitizeLabel(row.channel || "unknown") };
    const totals = normalizeTotals(row.totals);
    samples.push({ name: `${PREFIX}_channel_tokens_total`, labels, value: totals.totalTokens });
    samples.push({ name: `${PREFIX}_channel_cost_usd_total`, labels, value: totals.totalCost });
  }
}

function appendDailySamples(
  samples: MetricSample[],
  costRows: UsageCostDailyEntry[] | undefined,
  sessionRows:
    | Array<{
        date?: string;
        tokens?: number;
        cost?: number;
        messages?: number;
        toolCalls?: number;
        errors?: number;
      }>
    | undefined,
): void {
  const merged = new Map<string, {
    tokens?: number;
    cost?: number;
    messages?: number;
    toolCalls?: number;
    errors?: number;
  }>();

  if (Array.isArray(costRows)) {
    for (const row of costRows) {
      const date = sanitizeLabel(row.date || "unknown");
      const existing = merged.get(date) ?? {};
      merged.set(date, {
        ...existing,
        tokens:
          num(row.totalTokens) > 0
            ? num(row.totalTokens)
            : num(row.input) + num(row.output) + num(row.cacheRead) + num(row.cacheWrite),
        cost: num(row.totalCost),
      });
    }
  }

  if (Array.isArray(sessionRows)) {
    for (const row of sessionRows) {
      const date = sanitizeLabel(row.date || "unknown");
      const existing = merged.get(date) ?? {};
      merged.set(date, {
        ...existing,
        tokens: existing.tokens ?? num(row.tokens),
        cost: existing.cost ?? num(row.cost),
        messages: num(row.messages),
        toolCalls: num(row.toolCalls),
        errors: num(row.errors),
      });
    }
  }

  if (merged.size === 0) {
    return;
  }

  for (const [date, row] of merged.entries()) {
    const labels = { date };
    samples.push({ name: `${PREFIX}_daily_tokens_total`, labels, value: num(row.tokens) });
    samples.push({ name: `${PREFIX}_daily_cost_usd_total`, labels, value: num(row.cost) });
    samples.push({ name: `${PREFIX}_daily_messages_total`, labels, value: num(row.messages) });
    samples.push({ name: `${PREFIX}_daily_tool_calls_total`, labels, value: num(row.toolCalls) });
    samples.push({ name: `${PREFIX}_daily_errors_total`, labels, value: num(row.errors) });
  }
}

function appendDailyLatencySamples(
  samples: MetricSample[],
  rows:
    | Array<{
        date?: string;
        count?: number;
        avgMs?: number;
        p95Ms?: number;
        minMs?: number;
        maxMs?: number;
      }>
    | undefined,
): void {
  if (!Array.isArray(rows)) {
    return;
  }
  for (const row of rows) {
    const labels = { date: sanitizeLabel(row.date || "unknown") };
    samples.push({ name: `${PREFIX}_daily_latency_count`, labels, value: num(row.count) });
    samples.push({ name: `${PREFIX}_daily_latency_avg_seconds`, labels, value: num(row.avgMs) / 1000 });
    samples.push({ name: `${PREFIX}_daily_latency_p95_seconds`, labels, value: num(row.p95Ms) / 1000 });
    samples.push({ name: `${PREFIX}_daily_latency_min_seconds`, labels, value: num(row.minMs) / 1000 });
    samples.push({ name: `${PREFIX}_daily_latency_max_seconds`, labels, value: num(row.maxMs) / 1000 });
  }
}

function appendModelDailySamples(
  samples: MetricSample[],
  rows:
    | Array<{
        date?: string;
        provider?: string;
        model?: string;
        count?: number;
        tokens?: number;
        cost?: number;
      }>
    | undefined,
): void {
  if (!Array.isArray(rows)) {
    return;
  }
  for (const row of rows) {
    const provider = sanitizeLabel(row.provider || "unknown");
    if (provider === "openclaw") continue;
    const labels = {
      date: sanitizeLabel(row.date || "unknown"),
      provider,
      model: sanitizeLabel(row.model || "unknown"),
    };
    samples.push({ name: `${PREFIX}_model_daily_requests_total`, labels, value: num(row.count) });
    samples.push({ name: `${PREFIX}_model_daily_tokens_total`, labels, value: num(row.tokens) });
    samples.push({ name: `${PREFIX}_model_daily_cost_usd_total`, labels, value: num(row.cost) });
  }
}

function buildUsageWindowParams(now = new Date()): {
  startDate: string;
  endDate: string;
  mode: "specific";
  utcOffset: string;
} {
  const end = new Date(now);
  const start = new Date(now);
  start.setDate(start.getDate() - (DEFAULT_USAGE_WINDOW_DAYS - 1));

  return {
    startDate: formatLocalDate(start),
    endDate: formatLocalDate(end),
    mode: "specific",
    utcOffset: formatUtcOffset(now),
  };
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatUtcOffset(date: Date): string {
  const totalMinutes = -date.getTimezoneOffset();
  const sign = totalMinutes >= 0 ? "+" : "-";
  const absMinutes = Math.abs(totalMinutes);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  if (minutes === 0) {
    return `UTC${sign}${hours}`;
  }
  return `UTC${sign}${hours}:${String(minutes).padStart(2, "0")}`;
}
