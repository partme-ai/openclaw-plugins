/**
 * @fileoverview OpenClaw 生命周期事件到 Trace/Span 状态机的适配层。
 *
 * message_received 创建根 Span，before/after_tool_call 管理工具子 Span，最终回复或 agent_end
 * 幂等结束 Trace，session_end 则关闭异常中断链路。默认不采集消息正文；显式开启时也只保留
 * 有界片段。Hook 错误会记录但不应阻断 Agent 主业务流程。
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { TracingBackend, TracingConfig } from "../shared/types.js";
import { TracingSampler } from "./sampler.js";
import { redactTraceText } from "../shared/redact.js";
import { createTraceStore } from "./trace-store.js";
import * as defaultTraceStore from "./trace-store.js";
import { hasPendingInternalDiagnosticEvent, onInternalDiagnosticEvent } from "openclaw/plugin-sdk/diagnostic-runtime";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
type TraceStore = ReturnType<typeof createTraceStore>;

// OpenClaw invokes all diagnostic listeners synchronously, then lets their
// async context providers run. Keep one bounded ticket per event until every
// listener has finished; a slow provider must not resurrect an evicted claim.
const TELEMETRY_EVENTS_KEY = Symbol.for("partme.tracing.deliveryTelemetryEvents.v1");
const MAX_TELEMETRY_EVENTS = 1024;
const MAX_TELEMETRY_SINKS_PER_EVENT = 128;
const TELEMETRY_EVENT_TIMEOUT_MS = 30_000;
interface TelemetryEventEntry {
  pending: number;
  dispatched: boolean;
  closed: boolean;
  sinks: Set<string | TracingBackend>;
  timeout: ReturnType<typeof setTimeout>;
}
interface TelemetryEventTicket {
  claim: (backend: TracingBackend, config: TracingConfig) => boolean;
  release: () => void;
}
function telemetryEvents(): Map<number, TelemetryEventEntry> {
  const global = globalThis as unknown as Record<symbol, unknown>;
  let events = global[TELEMETRY_EVENTS_KEY] as Map<number, TelemetryEventEntry> | undefined;
  if (!(events instanceof Map)) global[TELEMETRY_EVENTS_KEY] = events = new Map();
  return events;
}
/** @internal The host invokes listeners synchronously for each diagnostic sequence. */
export function reserveTelemetryEvent(sequence: unknown): TelemetryEventTicket | undefined {
  if (!Number.isSafeInteger(sequence) || (sequence as number) <= 0) return undefined;
  const seq = sequence as number;
  const events = telemetryEvents();
  let entry = events.get(seq);
  if (!entry) {
    if (events.size >= MAX_TELEMETRY_EVENTS) return undefined;
    const timeout = setTimeout(() => {
      entry!.closed = true;
      events.delete(seq);
    }, TELEMETRY_EVENT_TIMEOUT_MS);
    timeout.unref?.();
    entry = { pending: 0, dispatched: false, closed: false, sinks: new Set(), timeout };
    events.set(seq, entry);
    queueMicrotask(() => {
      entry!.dispatched = true;
      if (entry!.pending === 0) {
        clearTimeout(entry!.timeout);
        if (events.get(seq) === entry) events.delete(seq);
      }
    });
  }
  if (entry.closed) return undefined;
  entry.pending += 1;
  let released = false;
  return {
    claim: (backend, config) => {
      if (entry.closed) return false;
      const sink = telemetrySinkKey(config) ?? backend;
      if (entry.sinks.has(sink) || entry.sinks.size >= MAX_TELEMETRY_SINKS_PER_EVENT) return false;
      entry.sinks.add(sink);
      return true;
    },
    release: () => {
      if (released) return;
      released = true;
      entry.pending -= 1;
      if (entry.dispatched && entry.pending === 0) {
        clearTimeout(entry.timeout);
        if (events.get(seq) === entry) events.delete(seq);
      }
    },
  };
}
function telemetrySinkKey(config: TracingConfig): string | undefined {
  if (config.backend === "otlp") {
    const headers = Object.entries(config.otlpHeaders)
      .map(([name, value]): [string, string] => [name.toLowerCase(), value])
      .sort(([leftName, leftValue], [rightName, rightValue]) =>
        leftName.localeCompare(rightName) || leftValue.localeCompare(rightValue));
    return createHash("sha256").update(JSON.stringify(["otlp", new URL(config.otlpEndpoint).toString(), headers])).digest("hex");
  }
  if (config.backend === "file") {
    return createHash("sha256").update(JSON.stringify(["file", resolve(config.traceDir)])).digest("hex");
  }
  return undefined;
}
/** 单次 Gateway 生命周期中供所有 tracing hooks 共享的后端、采样器与不可变配置。 */
export interface TracingHookContext {
  backend: TracingBackend;
  sampler: TracingSampler;
  config: TracingConfig;
}

/**
 * Hook 获取当前追踪上下文的惰性提供器。
 *
 * OpenClaw 的 hook runtime 可能与 gateway_start 实例隔离，因此提供器允许异步初始化；返回
 * `null` 表示追踪禁用，Hook 必须保持静默且不能阻断业务消息。
 */
export type TracingHookContextProvider = () =>
  | TracingHookContext
  | null
  | Promise<TracingHookContext | null>;

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readMessageContent(event: Record<string, unknown>, captureBody: boolean): string | undefined {
  if (!captureBody || typeof event.content !== "string") return undefined;
  return event.content.slice(0, 500);
}

function readLastUserMessage(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (typeof message !== "object" || message === null || message.role !== "user") continue;
    const content = message.content;
    if (typeof content === "string") return content.slice(0, 500);
    if (Array.isArray(content)) {
      const text = content
        .filter((part) => part && typeof part === "object" && part.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n");
      if (text) return text.slice(0, 500);
    }
  }
  return undefined;
}

function readTraceId(value: unknown): string | undefined {
  const traceId = readString(value);
  return traceId && /^[a-fA-F0-9]{32}$/.test(traceId) ? traceId.toLowerCase() : undefined;
}

function logHookError(api: OpenClawPluginApi, operation: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  api.logger.error(`[tracing] ${operation} failed: ${redactTraceText(message)}`);
}

/**
 * 惰性初始化失败必须 fail-open：Tracing 故障只降级观测能力，不能让消息或工具 Hook 抛回宿主。
 */
async function resolveHookContext(
  api: OpenClawPluginApi,
  getContext: TracingHookContextProvider,
  operation: string,
): Promise<TracingHookContext | null> {
  try {
    return await getContext();
  } catch (error) {
    logHookError(api, `${operation} context initialization`, error);
    return null;
  }
}

function traceOperationKey(sessionKey: string | undefined, runId: string | undefined): string | undefined {
  if (sessionKey) return `session:${sessionKey}`;
  if (runId) return `run:${runId}`;
  return undefined;
}

function toolBindingKey(toolCallId: string, traceId: string): string {
  // JSON 数组编码保留字段边界，避免简单字符串拼接在含分隔符 ID 上发生碰撞。
  return JSON.stringify([traceId, toolCallId]);
}

function correlationId(value: string): string {
  return `id_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

/** hooks 只注册一次，通过 provider 获取当前 gateway 生命周期的后端。 */
export function registerTracingPluginHooks(
  api: OpenClawPluginApi,
  getContext: TracingHookContextProvider,
  store: TraceStore = defaultTraceStore,
): () => Promise<void> {
  const {
    bindToolSpan, consumeSuppressedRun, consumeSuppressedSession, createSpan, endSpan,
    finishActiveTrace, getActiveTraceCount, incrementSpanCount, randomHexId,
    rememberCompletedRun, suppressRun, suppressSession, registerActiveTrace,
    resolveActiveTrace, takeToolSpanId,
  } = store;
  /** 同一注册实例的 Hook 状态变更串行执行。 */
  const traceOperationChains = new Map<string, Promise<void>>();
  const telemetryExports = new Set<Promise<void>>();
  const runLinks = new Map<string, { traceId: string; rootSpanId: string }>();
  const pendingDelivery = new Map<string, Array<{ exportSpan: (link?: { traceId: string; rootSpanId: string }) => Promise<void>; timeout: ReturnType<typeof setTimeout> }>>();
  const MAX_RUN_LINKS = 1_000;
  const MAX_PENDING_DELIVERIES = 1_024;
  let pendingDeliveryCount = 0;
  const trackExport = (promise: Promise<void>) => {
    const observed = promise.catch((error) => logHookError(api, "telemetry export", error));
    telemetryExports.add(observed);
    void observed.finally(() => telemetryExports.delete(observed));
  };
  const linkRun = (runId: string, traceId: string, rootSpanId: string) => {
    const key = correlationId(runId);
    if (runLinks.has(key)) runLinks.delete(key);
    runLinks.set(key, { traceId, rootSpanId });
    while (runLinks.size > MAX_RUN_LINKS) runLinks.delete(runLinks.keys().next().value!);
    const pending = pendingDelivery.get(key);
    if (!pending) return;
    pendingDelivery.delete(key);
    pendingDeliveryCount -= pending.length;
    for (const item of pending) {
      clearTimeout(item.timeout);
      trackExport(item.exportSpan({ traceId, rootSpanId }));
    }
  };
  let stopTelemetry: () => void = () => {};
  let stopPromise: Promise<void> | null = null;
  const hookOpts = { priority: 100 };
  let lifecycleClosed = false;
  let hookGeneration = 0;
  const isLive = (generation: number) => !lifecycleClosed && generation === hookGeneration;
  const getLiveContext = async () => {
    const generation = hookGeneration;
    if (!isLive(generation)) return null;
    const context = await getContext();
    return isLive(generation) ? context : null;
  };
  async function runTraceOperation(key: string, generation: number, operation: (stillLive: () => boolean) => void | Promise<void>): Promise<void> {
    const stillLive = () => isLive(generation);
    const previous = traceOperationChains.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => stillLive() ? operation(stillLive) : undefined);
    traceOperationChains.set(key, current);
    try { await current; }
    finally { if (traceOperationChains.get(key) === current) traceOperationChains.delete(key); }
  }
  const stopHooks = (): Promise<void> => {
    if (lifecycleClosed) return stopPromise ?? Promise.resolve();
    lifecycleClosed = true;
    hookGeneration += 1;
    // Preserve O5 immediate generation invalidation. The host's queued
    // diagnostics cannot be claimed as collected after this boundary.
    if (hasPendingInternalDiagnosticEvent((event) => event.type === "log.record" &&
        event.loggerName === "partme.delivery-recall.v1")) {
      api.logger.warn("[tracing] diagnostic queue pending at stop; delivery telemetry may be incomplete");
    }
    const unsubscribe = stopTelemetry;
    stopTelemetry = () => {};
    unsubscribe();
    for (const items of pendingDelivery.values()) {
      for (const item of items) {
        clearTimeout(item.timeout);
        trackExport(item.exportSpan());
      }
    }
    pendingDelivery.clear();
    pendingDeliveryCount = 0;
    runLinks.clear();
    const stopping = (async () => {
    const pending = [...traceOperationChains.values()];
    traceOperationChains.clear();
    await Promise.allSettled(pending);
    await Promise.allSettled([...telemetryExports]);
    })();
    stopPromise = stopping;
    void stopping.finally(() => { if (stopPromise === stopping) stopPromise = null; });
    return stopping;
  };
  const subscribeTelemetry = () => onInternalDiagnosticEvent((event) => {
    if (lifecycleClosed || event.type !== "log.record" || event.loggerName !== "partme.delivery-recall.v1" ||
        event.level !== "info" || !event.attributes) return;
    const attributes = event.attributes;
    const kind = attributes.event;
    const allowedKinds = ["started", "settlement", "retry", "dlq", "recall"];
    if (typeof kind !== "string" || !allowedKinds.includes(kind)) return;
    const allowedKeys = new Set(["event", "channel", "outcome", "plugin", "duration_ms", "entries", "run_id", "message_id", "delivery_id"]);
    if (Object.keys(attributes).some((key) => !allowedKeys.has(key))) return;
    for (const key of ["run_id", "message_id", "delivery_id"] as const) {
      const value = attributes[key];
      if (value !== undefined && (typeof value !== "string" || !/^id_[a-f0-9]{24}$/u.test(value))) return;
    }
    if ((kind === "recall" && event.message !== "recall telemetry") ||
        (kind !== "recall" && event.message !== "delivery telemetry")) return;
    if (kind === "recall" && (attributes.plugin !== "memory" && attributes.plugin !== "openmem" ||
        typeof attributes.duration_ms !== "number" || !Number.isFinite(attributes.duration_ms) ||
        attributes.duration_ms < 0 || attributes.duration_ms > 600_000 || attributes.channel !== undefined ||
        attributes.outcome !== undefined || attributes.entries !== undefined || attributes.run_id !== undefined ||
        attributes.message_id !== undefined || attributes.delivery_id !== undefined)) return;
    const channels = ["mqtt", "rabbitmq", "redis-stream", "rocketmq", "stomp", "web-mqtt", "web-stomp", "router", "other"];
    if (kind !== "recall" && (typeof attributes.channel !== "string" || !channels.includes(attributes.channel))) return;
    if (kind === "settlement" && (!["delivered", "failed", "ambiguous"].includes(String(attributes.outcome)) ||
        attributes.plugin !== undefined || attributes.duration_ms !== undefined || attributes.entries !== undefined)) return;
    if (kind === "started" && (attributes.delivery_id === undefined || attributes.outcome !== undefined ||
        attributes.plugin !== undefined || attributes.duration_ms !== undefined || attributes.entries !== undefined)) return;
    if (kind === "retry" && (attributes.outcome !== undefined || attributes.plugin !== undefined ||
        attributes.duration_ms !== undefined || attributes.entries !== undefined)) return;
    if (kind === "dlq" && (attributes.channel !== "router" || typeof attributes.entries !== "number" ||
        !Number.isInteger(attributes.entries) || attributes.entries < 0 || attributes.entries > 1_000_000 ||
        attributes.outcome !== undefined || attributes.plugin !== undefined || attributes.duration_ms !== undefined ||
        attributes.run_id !== undefined || attributes.message_id !== undefined || attributes.delivery_id !== undefined)) return;
    if (telemetryExports.size >= 256) {
      api.logger.warn("[tracing] telemetry export cap reached; delivery telemetry may be incomplete");
      return;
    }
    const ticket = reserveTelemetryEvent(event.seq);
    if (!ticket) {
      api.logger.warn("[tracing] telemetry event cap reached; delivery telemetry may be incomplete");
      return;
    }
    const generation = hookGeneration;
    const exportFact = (async () => {
      try {
        const context = await resolveHookContext(api, getLiveContext, "telemetry");
        if (!context || !isLive(generation) || !ticket.claim(context.backend, context.config)) return;
        const fields: Record<string, string | number | boolean> = { "partme.event": kind };
        for (const key of ["channel", "outcome", "plugin"] as const) {
          const value = attributes[key];
          if (typeof value === "string" && /^[a-z-]{1,24}$/u.test(value)) fields[`partme.${key}`] = value;
        }
        for (const key of ["run_id", "message_id", "delivery_id"] as const) {
          const value = attributes[key];
          if (typeof value === "string" && /^id_[a-f0-9]{24}$/u.test(value)) fields[`partme.${key}`] = value;
        }
        const duration = attributes.duration_ms;
        if (typeof duration === "number" && Number.isFinite(duration) && duration >= 0 && duration <= 600_000) {
          fields["partme.duration_ms"] = duration;
        }
        if (kind === "dlq") fields["partme.entries"] = attributes.entries as number;
        const observedAtMs = Date.now();
        const exportSpan = async (link?: { traceId: string; rootSpanId: string }) => {
          const span = createSpan(kind === "recall" ? "memory.recall" : `delivery.${kind}`, {
            ...(link ? { traceId: link.traceId, parentSpanId: link.rootSpanId } : {}),
            kind: "internal", attributes: fields,
          });
          await endSpan(span.spanId, kind === "settlement" && attributes.outcome !== "delivered" ? "error" : "ok",
            context.backend, typeof duration === "number" ? { durationMs: duration, endTimeMs: observedAtMs }
              : { durationMs: 0, endTimeMs: observedAtMs });
        };
        const runKey = kind === "started" || kind === "settlement" ? attributes.run_id : undefined;
        if (typeof runKey === "string") {
          const linked = runLinks.get(runKey);
          if (linked) { await exportSpan(linked); return; }
          if (pendingDeliveryCount < MAX_PENDING_DELIVERIES) {
            const item = { exportSpan, timeout: setTimeout(() => {
              const queue = pendingDelivery.get(runKey);
              if (!queue || !queue.includes(item)) return;
              queue.splice(queue.indexOf(item), 1);
              pendingDeliveryCount -= 1;
              if (queue.length === 0) pendingDelivery.delete(runKey);
              trackExport(exportSpan());
            }, 120_000) };
            item.timeout.unref?.();
            const queue = pendingDelivery.get(runKey) ?? [];
            queue.push(item);
            pendingDelivery.set(runKey, queue);
            pendingDeliveryCount += 1;
            return;
          }
        }
        await exportSpan();
      } finally {
        ticket.release();
      }
    })().catch((error) => logHookError(api, "telemetry export", error));
    telemetryExports.add(exportFact);
    void exportFact.finally(() => telemetryExports.delete(exportFact));
  }, { include: ["log.record"] });
  stopTelemetry = subscribeTelemetry();
  api.on("gateway_stop", stopHooks, hookOpts);
  api.on("gateway_start", () => {
    if (!lifecycleClosed) return;
    hookGeneration += 1;
    lifecycleClosed = false;
    stopTelemetry = subscribeTelemetry();
  }, hookOpts);

  api.on(
    "message_received",
    async (event, ctx) => {
      const eventGeneration = hookGeneration;
      const hookContext = await resolveHookContext(api, getLiveContext, "message_received");
      if (!hookContext || !isLive(eventGeneration)) return;
      const { backend, sampler, config } = hookContext;
      const sessionKey = readString(ctx.sessionKey);
      const runId = readString(ctx.runId);
      const operationKey = traceOperationKey(sessionKey, runId);
      if (!operationKey) {
        api.logger.warn("[tracing] message_received skipped because both sessionKey and runId are missing");
        return;
      }
      const channelId = readString(ctx.channelId) ?? "unknown";
      const traceId = readTraceId(ctx.traceId) ?? randomHexId(16);
      if (!sampler.shouldSample(traceId)) {
        if (runId) suppressRun(runId);
        if (sessionKey) suppressSession(sessionKey);
        return;
      }

      await runTraceOperation(operationKey, eventGeneration, async (stillLive) => {
        const previous = runId ? resolveActiveTrace(undefined, runId) : resolveActiveTrace(sessionKey);
        if (previous) {
          try {
            await finishActiveTrace(runId ? undefined : sessionKey, runId, "error", backend, "superseded_by_new_message");
          } catch (error) {
            logHookError(api, "closing superseded trace", error);
          }
          if (!stillLive()) return;
        } else if (getActiveTraceCount() >= config.maxActiveTraces) {
          if (runId) suppressRun(runId);
          if (sessionKey) suppressSession(sessionKey);
          api.logger.error(
            `[tracing] active trace limit reached (${config.maxActiveTraces}); skipped channel=${channelId}`,
          );
          return;
        }
        const messageText = readMessageContent(event as Record<string, unknown>, config.captureMessageBody);
        const messageId = readString(ctx.messageId);
        const rootSpan = createSpan("message.received", {
          traceId,
          kind: "server",
          attributes: {
            "openclaw.channel": channelId,
            ...(sessionKey ? { "openclaw.session_key": sessionKey } : {}),
            ...(runId ? { "openclaw.run_id": runId } : {}),
            ...(messageId ? { "openclaw.message_id": messageId } : {}),
            ...(runId ? { "partme.run_id": correlationId(runId) } : {}),
            ...(messageId ? { "partme.message_id": correlationId(messageId) } : {}),
            ...(messageText ? { "openclaw.message_text": messageText } : {}),
          },
        });
        registerActiveTrace({
          traceId,
          rootSpanId: rootSpan.spanId,
          spanCount: 1,
          sessionKey,
          runId,
        });
        if (runId) linkRun(runId, traceId, rootSpan.spanId);
        // A prior turn in the same session may have been suppressed without
        // ever producing agent_end. The new accepted root owns this session.
        if (sessionKey) consumeSuppressedSession(sessionKey);
      });
    },
    hookOpts,
  );

  api.on(
    "before_tool_call",
    async (event, ctx) => {
      const eventGeneration = hookGeneration;
      const hookContext = await resolveHookContext(api, getLiveContext, "before_tool_call");
      if (!hookContext || !isLive(eventGeneration)) return;
      const toolCallId = readString(event.toolCallId);
      if (!toolCallId) return;
      const sessionKey = readString(ctx.sessionKey);
      const runId = readString(ctx.runId);
      const operationKey = traceOperationKey(sessionKey, runId);
      if (!operationKey) return;
      await runTraceOperation(operationKey, eventGeneration, () => {
        const active = runId ? resolveActiveTrace(undefined, runId) : resolveActiveTrace(sessionKey);
        if (!active || !incrementSpanCount(active, hookContext.config.maxSpansPerTrace)) return;

        const toolName = readString(event.toolName) ?? "unknown";
        const span = createSpan(`tool:${toolName}`, {
          traceId: active.traceId,
          parentSpanId: active.rootSpanId,
          kind: "client",
          attributes: {
            "openclaw.tool_name": toolName,
            "openclaw.tool_call_id": toolCallId,
          },
        });
        bindToolSpan(toolBindingKey(toolCallId, active.traceId), span.spanId, active.traceId);
      });
    },
    hookOpts,
  );

  api.on(
    "after_tool_call",
    async (event, ctx) => {
      const eventGeneration = hookGeneration;
      const hookContext = await resolveHookContext(api, getLiveContext, "after_tool_call");
      if (!hookContext || !isLive(eventGeneration)) return;
      const toolCallId = readString(event.toolCallId);
      if (!toolCallId) return;
      const sessionKey = readString(ctx.sessionKey);
      const runId = readString(ctx.runId);
      const operationKey = traceOperationKey(sessionKey, runId);
      if (!operationKey) return;
      await runTraceOperation(operationKey, eventGeneration, async () => {
        const active = runId ? resolveActiveTrace(undefined, runId) : resolveActiveTrace(sessionKey);
        const spanId = active ? takeToolSpanId(toolBindingKey(toolCallId, active.traceId)) : undefined;
        if (!spanId) return;
        try {
          await endSpan(spanId, event.error ? "error" : "ok", hookContext.backend, {
            durationMs: typeof event.durationMs === "number" ? event.durationMs : undefined,
            attributes: event.error ? { "openclaw.tool_error": String(event.error).slice(0, 500) } : undefined,
          });
        } catch (error) {
          logHookError(api, "exporting tool span", error);
        }
      });
    },
    hookOpts,
  );

  api.on(
    "reply_payload_sending",
    async (event, ctx) => {
      const eventGeneration = hookGeneration;
      const hookContext = await resolveHookContext(api, getLiveContext, "reply_payload_sending");
      if (!hookContext || !isLive(eventGeneration) || event.kind !== "final") return;
      const sessionKey = readString(event.sessionKey) ?? readString(ctx.sessionKey);
      const runId = readString(event.runId) ?? readString(ctx.runId);
      const operationKey = traceOperationKey(sessionKey, runId);
      if (!operationKey) return;
      await runTraceOperation(operationKey, eventGeneration, async () => {
        try {
          await finishActiveTrace(runId ? undefined : sessionKey, runId, "ok", hookContext.backend, "reply_payload_final");
        } catch (error) {
          logHookError(api, "ending reply trace", error);
        }
      });
    },
    hookOpts,
  );

  // Custom channel dispatchers (including the Message SDK wire bridges) can
  // deliver replies without traversing OpenClaw's standard outbound hook path.
  // agent_end is the host-wide terminal signal for the Agent run, so use it as
  // an idempotent fallback. Standard channels normally close the trace from
  // reply_payload_sending first; finishActiveTrace then makes this a no-op.
  api.on(
    "agent_end",
    async (event, ctx) => {
      const eventGeneration = hookGeneration;
      const hookContext = await resolveHookContext(api, getLiveContext, "agent_end");
      if (!hookContext || !isLive(eventGeneration)) return;
      const sessionKey = readString(ctx.sessionKey);
      const runId = readString(event.runId) ?? readString(ctx.runId);
      const operationKey = traceOperationKey(sessionKey, runId);
      if (!operationKey) return;
      await runTraceOperation(operationKey, eventGeneration, async (stillLive) => {
        try {
          const exactRoot = runId ? resolveActiveTrace(undefined, runId) : undefined;
          if (runId && exactRoot) linkRun(runId, exactRoot.traceId, exactRoot.rootSpanId);
          const finished = await finishActiveTrace(
            runId ? undefined : sessionKey,
            runId,
            event.success ? "ok" : "error",
            hookContext.backend,
            event.success ? "agent_end_success" : "agent_end_error",
          );
          if (!stillLive()) return;
          const suppressedByRun = runId ? consumeSuppressedRun(runId) : false;
          const suppressedBySession = sessionKey ? consumeSuppressedSession(sessionKey) : false;
          if (suppressedByRun || suppressedBySession) {
            if (runId) rememberCompletedRun(runId);
          }
          // Some custom channel dispatchers reach agent_end without a visible
          // message_received hook in this runtime. Export the observed Agent
          // terminal event instead of silently reporting zero traces.
          if (!finished && runId && !suppressedByRun && !suppressedBySession && rememberCompletedRun(runId)) {
            if (getActiveTraceCount() >= hookContext.config.maxActiveTraces) return;
            const traceId = readTraceId((ctx as { trace?: { traceId?: unknown } }).trace?.traceId)
              ?? readTraceId((ctx as { traceId?: unknown }).traceId) ?? randomHexId(16);
            if (hookContext.sampler.shouldSample(traceId)) {
              const messageText = hookContext.config.captureMessageBody
                ? readLastUserMessage(event.messages)
                : undefined;
              const span = createSpan("agent.run", {
                traceId,
                kind: "internal",
                attributes: {
                  ...(sessionKey ? { "openclaw.session_key": sessionKey } : {}),
                  "openclaw.run_id": runId,
                  ...(messageText ? { "openclaw.message_text": messageText } : {}),
                },
              });
              linkRun(runId, traceId, span.spanId);
              await endSpan(span.spanId, event.success ? "ok" : "error", hookContext.backend, {
                ...(typeof event.durationMs === "number" && Number.isFinite(event.durationMs) && event.durationMs >= 0
                  ? { durationMs: event.durationMs } : {}),
                attributes: { "openclaw.end_reason": event.success ? "agent_end_success" : "agent_end_error" },
              });
            }
          }
        } catch (error) {
          logHookError(api, "ending agent trace", error);
        }
      });
    },
    hookOpts,
  );

  api.on(
    "session_end",
    async (_event, ctx) => {
      const eventGeneration = hookGeneration;
      const hookContext = await resolveHookContext(api, getLiveContext, "session_end");
      if (!hookContext || !isLive(eventGeneration)) return;
      const sessionKey = readString(ctx.sessionKey);
      const runId = readString((ctx as { runId?: unknown }).runId);
      const operationKey = traceOperationKey(sessionKey, runId);
      if (!operationKey) return;
      await runTraceOperation(operationKey, eventGeneration, async () => {
        try {
          await finishActiveTrace(
            sessionKey,
            runId,
            "error",
            hookContext.backend,
            "session_end_before_final_reply",
          );
        } catch (error) {
          logHookError(api, "ending session trace", error);
        }
      });
    },
    hookOpts,
  );

  api.logger.info("[tracing] Hooks registered (message_received, tool, reply_payload_sending, agent_end, session_end)");
  return stopHooks;
}
