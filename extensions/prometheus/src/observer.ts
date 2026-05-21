import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { MetricSample } from "./types.js";
import { getRuntimeStore, listObservedChannelAccounts, rememberObservedChannelAccount, setSnapshotState } from "./runtime-store.js";

const PROVIDER_STATUSES = ["ok", "missing", "error"] as const;

// ─────────── HTTP 延迟环形缓冲区（用于计算 P95/P99） ───────────
const HTTP_LATENCY_SAMPLES: number[] = [];
const HTTP_LATENCY_MAX_SAMPLES = 1000;

export function registerPluginObservers(api: OpenClawPluginApi): void {
  registerLifecycleHooks(api);
  registerMessageHooks(api);
  registerToolHooks(api);
  registerAgentHooks(api);
  registerRuntimeEventListeners(api);
  registerSupplementaryPluginHooks(api);
}

function registerLifecycleHooks(api: OpenClawPluginApi): void {
  api.on("gateway_start", () => {
    const { registry, cfg } = getRuntimeStore();
    registry.set("openclaw_ready", 1, {
      help: "Whether the plugin observed gateway_start and considers the exporter ready",
      labels: { instance: cfg.instance || "default" },
    });
  });

  api.on("gateway_stop", () => {
    const { registry, cfg } = getRuntimeStore();
    registry.set("openclaw_ready", 0, {
      help: "Whether the plugin observed gateway_start and considers the exporter ready",
      labels: { instance: cfg.instance || "default" },
    });
  });

  api.on("session_start", (_event, ctx) => {
    const { registry } = getRuntimeStore();
    registry.inc("openclaw_sessions_started_total", 1, {
      help: "Session starts observed through plugin hooks",
      type: "counter",
    });
    if (ctx.sessionKey) {
      registry.inc("openclaw_sessions_active_estimated", 1, {
        help: "Estimated active sessions observed by the plugin",
      });
    }
  });

  api.on("session_end", (event) => {
    const { registry } = getRuntimeStore();
    registry.inc("openclaw_sessions_ended_total", 1, {
      help: "Session ends observed through plugin hooks",
      type: "counter",
      labels: { reason: event.reason ?? "unknown" },
    });
    registry.dec("openclaw_sessions_active_estimated", 1, {
      help: "Estimated active sessions observed by the plugin",
    });
  });
}

function registerMessageHooks(api: OpenClawPluginApi): void {
  api.on("message_received", (_event, ctx) => {
    const { registry } = getRuntimeStore();
    const channelId = stringOr(ctx.channelId, "unknown");
    const accountId = optionalString(ctx.accountId);
    rememberObservedChannelAccount(channelId, accountId);
    registry.inc("openclaw_session_messages_received_total", 1, {
      help: "Inbound messages observed through plugin hooks",
      type: "counter",
      labels: { channel: channelId },
    });
    registry.set("openclaw_channel_last_event_timestamp_seconds", Date.now() / 1000, {
      help: "Last observed event timestamp by channel/account",
      labels: {
        channel: channelId,
        account: accountId ?? "default",
      },
    });
  });

  api.on("message_sent", (event, ctx) => {
    const { registry } = getRuntimeStore();
    const channelId = stringOr(ctx.channelId, "unknown");
    const accountId = optionalString(ctx.accountId);
    rememberObservedChannelAccount(channelId, accountId);
    registry.inc("openclaw_session_messages_sent_total", 1, {
      help: "Outbound messages observed through plugin hooks",
      type: "counter",
      labels: {
        channel: channelId,
        result: event.success ? "ok" : "error",
      },
    });
    if (!event.success) {
      registry.inc("openclaw_channel_failures_total", 1, {
        help: "Channel send failures observed through plugin hooks",
        type: "counter",
        labels: {
          channel: channelId,
          reason: event.error ? "send-error" : "unknown",
        },
      });
    }
  });
}

function registerToolHooks(api: OpenClawPluginApi): void {
  api.on("before_tool_call", (event) => {
    const { registry } = getRuntimeStore();
    registry.inc("openclaw_tool_calls_total", 1, {
      help: "Tool calls observed through plugin hooks",
      type: "counter",
      labels: { tool: event.toolName },
    });
    registry.inc("openclaw_inflight_operations", 1, {
      help: "Estimated in-flight operations tracked by the plugin",
      labels: { kind: "tool" },
    });
  });

  api.on("after_tool_call", (event) => {
    const { registry } = getRuntimeStore();
    registry.dec("openclaw_inflight_operations", 1, {
      help: "Estimated in-flight operations tracked by the plugin",
      labels: { kind: "tool" },
    });
    if (event.error) {
      registry.inc("openclaw_tool_call_failures_total", 1, {
        help: "Tool call failures observed through plugin hooks",
        type: "counter",
        labels: { tool: event.toolName },
      });
    }
    if (typeof event.durationMs === "number") {
      registry.observeHistogram("openclaw_tool_call_duration_seconds", event.durationMs / 1000, {
        help: "Observed tool call duration",
        labels: { tool: event.toolName },
      });
    }
  });
}

function registerAgentHooks(api: OpenClawPluginApi): void {
  api.on("before_agent_start", (_event, ctx) => {
    const { registry } = getRuntimeStore();
    const agentId = stringOr(ctx.agentId, "unknown");
    const channelId = stringOr(ctx.channelId, "unknown");
    registry.inc("openclaw_inflight_operations", 1, {
      help: "Estimated in-flight operations tracked by the plugin",
      labels: { kind: "agent" },
    });
    registry.inc("openclaw_agent_runs_started_total", 1, {
      help: "Agent runs observed through plugin hooks",
      type: "counter",
      labels: {
        agent_id: agentId,
        channel: channelId,
      },
    });
  });

  api.on("llm_output", (event) => {
    const { registry } = getRuntimeStore();
    const labels = {
      provider: event.provider,
      model: event.model,
    };
    registry.inc("openclaw_usage_tokens_input_total", event.usage?.input ?? 0, {
      help: "Input tokens observed through llm_output hooks",
      type: "counter",
      labels,
    });
    registry.inc("openclaw_usage_tokens_output_total", event.usage?.output ?? 0, {
      help: "Output tokens observed through llm_output hooks",
      type: "counter",
      labels,
    });
    const cacheRead = event.usage?.cacheRead ?? 0;
    const cacheWrite = event.usage?.cacheWrite ?? 0;
    if (cacheRead > 0) {
      registry.inc("openclaw_usage_tokens_cache_read_total", cacheRead, {
        help: "Cache read tokens observed through llm_output hooks",
        type: "counter",
        labels,
      });
    }
    if (cacheWrite > 0) {
      registry.inc("openclaw_usage_tokens_cache_write_total", cacheWrite, {
        help: "Cache write tokens observed through llm_output hooks",
        type: "counter",
        labels,
      });
    }
    registry.inc(
      "openclaw_usage_tokens_total",
      event.usage?.total ??
        (event.usage?.input ?? 0) +
          (event.usage?.output ?? 0) +
          (event.usage?.cacheRead ?? 0) +
          (event.usage?.cacheWrite ?? 0),
      {
        help: "Total tokens observed through llm_output hooks",
        type: "counter",
        labels,
      },
    );
  });

  api.on("agent_end", (event, ctx) => {
    const { registry } = getRuntimeStore();
    const agentId = stringOr(ctx.agentId, "unknown");
    registry.dec("openclaw_inflight_operations", 1, {
      help: "Estimated in-flight operations tracked by the plugin",
      labels: { kind: "agent" },
    });
    registry.inc("openclaw_agent_runs_total", 1, {
      help: "Agent runs observed through plugin hooks",
      type: "counter",
      labels: {
        agent_id: agentId,
        result: event.success ? "ok" : "error",
      },
    });
    if (!event.success) {
      registry.inc("openclaw_agent_runs_failed_total", 1, {
        help: "Agent run failures observed through plugin hooks (no result label to avoid cardinality explosion)",
        type: "counter",
        labels: { agent_id: agentId },
      });
    }
    if (typeof event.durationMs === "number") {
      registry.observeHistogram("openclaw_agent_run_duration_seconds", event.durationMs / 1000, {
        help: "Observed agent run duration",
        labels: {
          agent_id: agentId,
        },
      });
    }
  });
}

function registerRuntimeEventListeners(api: OpenClawPluginApi): void {
  api.runtime.events?.onAgentEvent?.((event) => {
    try {
      const { registry } = getRuntimeStore();
      registry.inc("openclaw_agent_events_total", 1, {
        help: "Agent runtime events observed through api.runtime.events.onAgentEvent",
        type: "counter",
        labels: { stream: event.stream },
      });

      if (event.stream === "item") {
        const kind = typeof event.data.kind === "string" ? event.data.kind : "unknown";
        const phase = typeof event.data.phase === "string" ? event.data.phase : "unknown";
        const status = typeof event.data.status === "string" ? event.data.status : "unknown";
        registry.inc("openclaw_agent_item_events_total", 1, {
          help: "Agent item events grouped by kind/status/phase",
          type: "counter",
          labels: { kind, phase, status },
        });
      }
    } catch {
      // 静默吞下 listener 异常，避免中断事件流
    }
  });

  api.runtime.events?.onSessionTranscriptUpdate?.((update) => {
    try {
      const { registry } = getRuntimeStore();
      registry.inc("openclaw_session_transcript_updates_total", 1, {
        help: "Session transcript updates observed through api.runtime.events.onSessionTranscriptUpdate",
        type: "counter",
      });
      registry.set("openclaw_session_transcript_last_update_timestamp_seconds", Date.now() / 1000, {
        help: "Last transcript update timestamp observed by the plugin",
      });
      if (update.sessionKey) {
        registry.set("openclaw_session_transcript_last_seen_timestamp_seconds", Date.now() / 1000, {
          help: "Last transcript update timestamp by session key",
          labels: { scope: "aggregate" },
        });
      }
    } catch {
      // 静默吞下 listener 异常
    }
  });
}

/**
 * 将 before_reset 等原因归一为低基数标签。
 *
 * @param reason - hook 事件中的 reason 字段
 */
function normalizeSessionResetReason(reason: unknown): string {
  if (typeof reason !== "string") {
    return "unknown";
  }
  const trimmed = reason.trim();
  if (
    trimmed === "new" ||
    trimmed === "reset" ||
    trimmed === "idle" ||
    trimmed === "daily" ||
    trimmed === "compaction" ||
    trimmed === "deleted"
  ) {
    return trimmed;
  }
  return trimmed.length > 0 ? "other" : "unknown";
}

/**
 * 递增通用 hook 调用计数（补充尚未在其它 register* 中单独建模的 SDK hooks）。
 *
 * @param hook - OpenClaw `PluginHookName`
 */
function incHookInvocation(hook: string): void {
  const { registry } = getRuntimeStore();
  registry.inc("openclaw_plugin_hook_invocations_total", 1, {
    help: "Plugin SDK hook invocations observed by openclaw-prometheus",
    type: "counter",
    labels: { hook },
  });
}

/**
 * 补充注册 OpenClaw 其余 Plugin SDK hooks（模型解析、压缩、子代理、派发、安装等）。
 */
function registerSupplementaryPluginHooks(api: OpenClawPluginApi): void {
  api.on("before_model_resolve", () => {
    incHookInvocation("before_model_resolve");
  });
  api.on("before_prompt_build", () => {
    incHookInvocation("before_prompt_build");
  });
  api.on("before_agent_reply", () => {
    incHookInvocation("before_agent_reply");
  });
  api.on("llm_input", (event) => {
    incHookInvocation("llm_input");
    const { registry } = getRuntimeStore();
    const provider = typeof event?.provider === "string" ? event.provider : "unknown";
    const model = typeof event?.model === "string" ? event.model : "unknown";
    const images =
      typeof event?.imagesCount === "number" && event.imagesCount > 0 ? event.imagesCount : 0;
    if (images > 0) {
      registry.inc("openclaw_model_llm_input_images_total", images, {
        help: "Images attached to LLM inputs observed through llm_input hooks",
        type: "counter",
        labels: { provider, model },
      });
    }
  });
  api.on("before_compaction", (event) => {
    incHookInvocation("before_compaction");
    const { registry } = getRuntimeStore();
    registry.inc("openclaw_session_compaction_events_total", 1, {
      help: "Session compaction-related hook events",
      type: "counter",
      labels: { phase: "before" },
    });
    const tokenCount = typeof event?.tokenCount === "number" ? event.tokenCount : undefined;
    if (typeof tokenCount === "number") {
      registry.set("openclaw_session_compaction_last_tokens_before", tokenCount, {
        help: "Token count observed on the last before_compaction hook",
      });
    }
  });
  api.on("after_compaction", (event) => {
    incHookInvocation("after_compaction");
    const { registry } = getRuntimeStore();
    registry.inc("openclaw_session_compaction_events_total", 1, {
      help: "Session compaction-related hook events",
      type: "counter",
      labels: { phase: "after" },
    });
    const compacted = typeof event?.compactedCount === "number" ? event.compactedCount : 0;
    if (compacted > 0) {
      registry.inc("openclaw_session_compaction_messages_compacted_total", compacted, {
        help: "Messages removed by compaction (after_compaction.compactedCount)",
        type: "counter",
      });
    }
    const tokenCountAfter = typeof event?.tokenCount === "number" ? event.tokenCount : undefined;
    if (typeof tokenCountAfter === "number") {
      registry.set("openclaw_session_compaction_last_tokens_after", tokenCountAfter, {
        help: "Token count observed on the last after_compaction hook",
      });
    }
  });
  api.on("before_reset", (event) => {
    incHookInvocation("before_reset");
    const { registry } = getRuntimeStore();
    const reason = normalizeSessionResetReason(event?.reason);
    registry.inc("openclaw_session_reset_requests_total", 1, {
      help: "Session reset requests observed through before_reset hooks",
      type: "counter",
      labels: { reason },
    });
  });
  api.on("inbound_claim", () => {
    incHookInvocation("inbound_claim");
  });
  api.on("message_sending", () => {
    incHookInvocation("message_sending");
  });
  api.on("tool_result_persist", (event) => {
    incHookInvocation("tool_result_persist");
    const tool = typeof event?.toolName === "string" ? event.toolName : "unknown";
    const { registry } = getRuntimeStore();
    registry.inc("openclaw_tool_result_persist_total", 1, {
      help: "Tool results persisted (tool_result_persist hook)",
      type: "counter",
      labels: { tool },
    });
  });
  api.on("before_message_write", () => {
    incHookInvocation("before_message_write");
  });
  api.on("subagent_spawning", () => {
    incHookInvocation("subagent_spawning");
  });
  api.on("subagent_delivery_target", () => {
    incHookInvocation("subagent_delivery_target");
  });
  api.on("subagent_spawned", () => {
    incHookInvocation("subagent_spawned");
  });
  api.on("subagent_ended", (event) => {
    incHookInvocation("subagent_ended");
    const { registry } = getRuntimeStore();
    const outcome = typeof event?.outcome === "string" ? event.outcome : "unknown";
    registry.inc("openclaw_agent_subagent_ended_total", 1, {
      help: "Subagent ended events by outcome",
      type: "counter",
      labels: { outcome },
    });
  });
  api.on("before_dispatch", () => {
    incHookInvocation("before_dispatch");
  });
  api.on("reply_dispatch", () => {
    incHookInvocation("reply_dispatch");
  });
  api.on("before_install", () => {
    incHookInvocation("before_install");
  });
}

export async function refreshRuntimeSnapshots(force = false): Promise<void> {
  const store = getRuntimeStore();
  const now = Date.now();
  if (
    !force &&
    typeof store.lastSnapshotRefreshAt === "number" &&
    now - store.lastSnapshotRefreshAt < store.cfg.snapshotIntervalMs
  ) {
    refreshChannelActivityGauges();
    return;
  }

  const providerSnapshots = await Promise.all(
    store.cfg.monitoredProviders.map(async (provider) => {
      try {
        const auth = await store.api.runtime.modelAuth?.resolveApiKeyForProvider?.({
          provider,
          cfg: store.api.config as Record<string, unknown>,
        });
        const status = auth?.apiKey || auth?.source ? "ok" : "missing";
        return {
          provider,
          status,
          source: auth?.source,
          mode: auth?.mode,
          checkedAt: now,
        } as const;
      } catch (error) {
        return {
          provider,
          status: "error",
          checkedAt: now,
          error: error instanceof Error ? error.message : String(error),
        } as const;
      }
    }),
  );

  setSnapshotState({
    refreshedAt: now,
    providerSnapshots: [...providerSnapshots],
  });

  const { registry } = store;
  registry.set("openclaw_runtime_snapshot_refresh_timestamp_seconds", now / 1000, {
    help: "Last successful runtime snapshot refresh timestamp",
  });
  registry.set("openclaw_runtime_snapshot_age_seconds", 0, {
    help: "Age of the last runtime snapshot refresh",
  });

  for (const snapshot of providerSnapshots) {
    if (snapshot.status === "error") {
      registry.inc("openclaw_model_auth_provider_probe_errors_total", 1, {
        help: "Errors while probing provider API keys during runtime snapshot refresh",
        type: "counter",
        labels: { provider: snapshot.provider },
      });
    }
    registry.setOneHotStatus(
      "openclaw_model_auth_provider_status",
      snapshot.status,
      PROVIDER_STATUSES,
      {
        help: "Provider auth resolution status from api.runtime.modelAuth.resolveApiKeyForProvider",
        labels: { provider: snapshot.provider },
      },
    );
    if (snapshot.source || snapshot.mode) {
      registry.set("openclaw_model_auth_provider_info", 1, {
        help: "Provider auth source/mode info from the last successful runtime snapshot",
        labels: {
          provider: snapshot.provider,
          source: snapshot.source ?? "unknown",
          mode: snapshot.mode ?? "unknown",
        },
      });
    }
  }

  refreshChannelActivityGauges();
}

export function refreshHousekeepingMetrics(): void {
  const store = getRuntimeStore();
  const { registry, cfg } = store;
  registry.set("openclaw_up", 1, {
    help: "Whether the OpenClaw Prometheus plugin is loaded",
    labels: { instance: cfg.instance || "default" },
  });
  registry.set("openclaw_ready", 1, {
    help: "Whether the OpenClaw Prometheus plugin runtime is initialized",
    labels: { instance: cfg.instance || "default" },
  });
  registry.set("openclaw_plugin_uptime_seconds", (Date.now() - store.startedAt) / 1000, {
    help: "Plugin uptime in seconds",
  });

  const lastRefresh = store.lastSnapshotRefreshAt ?? store.startedAt;
  registry.set("openclaw_runtime_snapshot_age_seconds", Math.max(0, (Date.now() - lastRefresh) / 1000), {
    help: "Age of the last runtime snapshot refresh",
  });

  registry.set("openclaw_runtime_namespace_available", store.api.runtime.events ? 1 : 0, {
    help: "Whether a runtime namespace is available",
    labels: { namespace: "events" },
  });
  registry.set("openclaw_runtime_namespace_available", store.api.runtime.modelAuth ? 1 : 0, {
    help: "Whether a runtime namespace is available",
    labels: { namespace: "modelAuth" },
  });
  registry.set("openclaw_runtime_namespace_available", store.api.runtime.channel ? 1 : 0, {
    help: "Whether a runtime namespace is available",
    labels: { namespace: "channel" },
  });
  registry.set("openclaw_runtime_namespace_available", store.api.runtime.state ? 1 : 0, {
    help: "Whether a runtime namespace is available",
    labels: { namespace: "state" },
  });

  const stateDir = store.api.runtime.state?.resolveStateDir?.();
  registry.set("openclaw_runtime_state_dir_configured", stateDir ? 1 : 0, {
    help: "Whether api.runtime.state.resolveStateDir returned a value",
  });

  // ─────────── 新增：时间序列基数监控 ───────────
  registry.set("openclaw_metrics_series_total", registry.snapshotSamples().length, {
    help: "Total number of metric series (cardinality)",
  });
}

function refreshChannelActivityGauges(): void {
  const store = getRuntimeStore();
  const getActivity = store.api.runtime.channel?.activity?.get;
  if (typeof getActivity !== "function") {
    return;
  }
  const nowSeconds = Date.now() / 1000;
  for (const observed of listObservedChannelAccounts()) {
    const activity = getActivity({
      channel: observed.channelId,
      ...(observed.accountId ? { accountId: observed.accountId } : {}),
    });
    const labels = {
      channel: observed.channelId,
      account: observed.accountId ?? "default",
    };
    if (typeof activity.inboundAt === "number") {
      store.registry.set("openclaw_channel_last_inbound_age_seconds", Math.max(0, nowSeconds - activity.inboundAt / 1000), {
        help: "Age of the last inbound activity seen for a channel/account",
        labels,
      });
    }
    if (typeof activity.outboundAt === "number") {
      store.registry.set("openclaw_channel_last_outbound_age_seconds", Math.max(0, nowSeconds - activity.outboundAt / 1000), {
        help: "Age of the last outbound activity seen for a channel/account",
        labels,
      });
    }
  }
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function stringOr(value: unknown, fallback: string): string {
  return optionalString(value) ?? fallback;
}

// ─────────── HTTP 延迟环形缓冲区（用于计算 P95/P99） ───────────

export function recordHttpLatency(seconds: number): void {
  HTTP_LATENCY_SAMPLES.push(seconds);
  if (HTTP_LATENCY_SAMPLES.length > HTTP_LATENCY_MAX_SAMPLES) {
    HTTP_LATENCY_SAMPLES.shift();
  }
}

export function refreshHttpLatencyMetrics(): void {
  const { registry } = getRuntimeStore();

  if (HTTP_LATENCY_SAMPLES.length > 0) {
    const sortedValues = [...HTTP_LATENCY_SAMPLES].sort((a, b) => a - b);
    const p95Index = Math.floor(sortedValues.length * 0.95);
    const p99Index = Math.floor(sortedValues.length * 0.99);

    registry.set("openclaw_sli_http_request_p95_seconds", sortedValues[p95Index], {
      help: "HTTP request duration P95 (95th percentile).",
    });
    registry.set("openclaw_sli_http_request_p99_seconds", sortedValues[p99Index], {
      help: "HTTP request duration P99 (99th percentile).",
    });
  }

  // ─────────── 环形缓冲区使用率监控 ───────────
  registry.set("openclaw_http_latency_samples_used", HTTP_LATENCY_SAMPLES.length, {
    help: "Number of HTTP latency samples in buffer",
  });
  registry.set("openclaw_http_latency_samples_usage_ratio", HTTP_LATENCY_SAMPLES.length / HTTP_LATENCY_MAX_SAMPLES, {
    help: "HTTP latency buffer usage ratio (0~1)",
  });
}

export function refreshSliMetrics(): void {
  const store = getRuntimeStore();
  const { registry } = store;

  // SLI 1: 消息投递成功率
  const msgOk = sumSamplesByLabel(registry.getSamplesByName("openclaw_session_messages_sent_total"), "result", "ok");
  const msgErr = sumSamplesByLabel(registry.getSamplesByName("openclaw_session_messages_sent_total"), "result", "error");
  const msgTotal = msgOk + msgErr;
  registry.set("openclaw_sli_message_success_ratio", msgTotal > 0 ? msgOk / msgTotal : 1, {
    help: "Message delivery success ratio (0~1). Source: openclaw_session_messages_sent_total{result}.",
  });

  // SLI 2: Agent 错误率
  const agentFailed = sumSamplesByLabel(registry.getSamplesByName("openclaw_agent_runs_total"), "result", "error");
  const agentStarted = registry.getSampleValue("openclaw_agent_runs_started_total");
  registry.set("openclaw_sli_agent_error_ratio", agentStarted > 0 ? agentFailed / agentStarted : 0, {
    help: "Agent run error ratio (0~1). Source: openclaw_agent_runs_total{result=error} / openclaw_agent_runs_started_total.",
  });

  // SLI 3: 工具调用错误率
  const toolFails = registry.getSampleValue("openclaw_tool_call_failures_total");
  const toolTotal = registry.getSampleValue("openclaw_tool_calls_total");
  registry.set("openclaw_sli_tool_error_ratio", toolTotal > 0 ? toolFails / toolTotal : 0, {
    help: "Tool call error ratio (0~1). Source: openclaw_tool_call_failures_total / openclaw_tool_calls_total.",
  });

  // SLI 4: 渠道健康率（从 rpcSamples 线性查找——RPC 样本量小，可接受）
  const channelLinked = store.rpcSamples.find((s: MetricSample) => s.name === "openclaw_channel_linked_total")?.value ?? 0;
  const channelTotal = store.rpcSamples.find((s: MetricSample) => s.name === "openclaw_channel_total")?.value ?? 0;
  registry.set("openclaw_sli_channel_health_ratio", channelTotal > 0 ? channelLinked / channelTotal : 1, {
    help: "Channel health ratio (0~1). Source: openclaw_channel_linked_total / openclaw_channel_total (RPC).",
  });
}

function sumSamplesByLabel(
  samples: Array<{ labels?: Record<string, string>; value: number }>,
  label: string,
  expectedValue: string,
): number {
  return samples.reduce((sum, sample) => {
    if (sample.labels?.[label] === expectedValue) {
      return sum + sample.value;
    }
    return sum;
  }, 0);
}
