import type { Span, SpanKind, SpanStatus, TracingBackend } from "../shared/types.js";

export interface ActiveTraceContext {
  traceId: string;
  rootSpanId: string;
  spanCount: number;
  sessionKey?: string;
  runId?: string;
  createdAtMs?: number;
  lastTouchedAtMs?: number;
}

export interface EndSpanOptions {
  endTimeMs?: number;
  durationMs?: number;
  attributes?: Record<string, string | number | boolean>;
}

const MAX_RECENT_TRACES = 200;
const DEFAULT_ACTIVE_TRACE_TTL_MS = 30 * 60_000;
const recentTraces = new Map<string, Span[]>();
const activeSpans = new Map<string, Span>();
const sessionTraceMap = new Map<string, ActiveTraceContext>();
const runTraceMap = new Map<string, ActiveTraceContext>();
const toolSpanMap = new Map<string, { spanId: string; traceId: string }>();

export function randomHexId(bytes: number): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function createSpan(
  name: string,
  options: {
    traceId?: string;
    parentSpanId?: string;
    kind?: SpanKind;
    attributes?: Record<string, string | number | boolean>;
  } = {},
): Span {
  const span: Span = {
    traceId: options.traceId ?? randomHexId(16),
    spanId: randomHexId(8),
    parentSpanId: options.parentSpanId,
    name,
    kind: options.kind ?? "internal",
    startTimeMs: Date.now(),
    attributes: { ...options.attributes },
    status: "unset",
    events: [],
  };
  activeSpans.set(span.spanId, span);
  return span;
}

/** 在导出前固化计时和属性，避免异步后端看到后续可变状态。 */
export async function endSpan(
  spanId: string,
  status: SpanStatus,
  backend: TracingBackend | null,
  options: EndSpanOptions = {},
): Promise<Span | undefined> {
  const span = activeSpans.get(spanId);
  if (!span) return undefined;

  const endTimeMs = options.endTimeMs ?? Date.now();
  if (options.durationMs !== undefined && Number.isFinite(options.durationMs) && options.durationMs >= 0) {
    span.startTimeMs = Math.max(0, endTimeMs - options.durationMs);
  }
  span.endTimeMs = endTimeMs;
  span.status = status;
  if (options.attributes) Object.assign(span.attributes, options.attributes);
  activeSpans.delete(spanId);

  const completed = cloneSpan(span);
  const trace = recentTraces.get(span.traceId) ?? [];
  trace.push(completed);
  recentTraces.delete(span.traceId);
  recentTraces.set(span.traceId, trace);
  while (recentTraces.size > MAX_RECENT_TRACES) {
    const oldest = recentTraces.keys().next().value as string | undefined;
    if (!oldest) break;
    recentTraces.delete(oldest);
  }
  if (backend) await backend.exportSpans([completed]);
  return cloneSpan(completed);
}

export function registerActiveTrace(ctx: ActiveTraceContext): void {
  const now = Date.now();
  ctx.createdAtMs ??= now;
  ctx.lastTouchedAtMs = now;
  if (ctx.sessionKey) sessionTraceMap.set(ctx.sessionKey, ctx);
  if (ctx.runId) runTraceMap.set(ctx.runId, ctx);
}

export function resolveActiveTrace(sessionKey?: string, runId?: string): ActiveTraceContext | undefined {
  const context = (runId ? runTraceMap.get(runId) : undefined)
    ?? (sessionKey ? sessionTraceMap.get(sessionKey) : undefined);
  if (context) context.lastTouchedAtMs = Date.now();
  return context;
}

export function incrementSpanCount(active: ActiveTraceContext, maxSpansPerTrace: number): boolean {
  active.lastTouchedAtMs = Date.now();
  if (active.spanCount >= maxSpansPerTrace) return false;
  active.spanCount += 1;
  return true;
}

export function clearActiveTrace(sessionKey?: string, runId?: string): ActiveTraceContext | undefined {
  const context = resolveActiveTrace(sessionKey, runId);
  if (!context) return undefined;
  for (const [key, candidate] of sessionTraceMap) {
    if (candidate === context) sessionTraceMap.delete(key);
  }
  for (const [key, candidate] of runTraceMap) {
    if (candidate === context) runTraceMap.delete(key);
  }
  return context;
}

export function bindToolSpan(toolCallId: string, spanId: string, traceId: string): void {
  toolSpanMap.set(toolCallId, { spanId, traceId });
}

export function takeToolSpanId(toolCallId: string): string | undefined {
  const binding = toolSpanMap.get(toolCallId);
  toolSpanMap.delete(toolCallId);
  return binding?.spanId;
}

/** 结束 trace 内仍悬挂的 tool span，再结束 root span并清理所有映射。 */
export async function finishActiveTrace(
  sessionKey: string | undefined,
  runId: string | undefined,
  rootStatus: SpanStatus,
  backend: TracingBackend | null,
  reason?: string,
): Promise<boolean> {
  const context = clearActiveTrace(sessionKey, runId);
  if (!context) return false;

  for (const [toolCallId, binding] of toolSpanMap) {
    if (binding.traceId === context.traceId) toolSpanMap.delete(toolCallId);
  }
  const childIds = Array.from(activeSpans.values())
    .filter((span) => span.traceId === context.traceId && span.spanId !== context.rootSpanId)
    .map((span) => span.spanId);
  let firstExportError: unknown;
  for (const childId of childIds) {
    try {
      await endSpan(childId, "error", backend, {
        attributes: { "openclaw.incomplete": true, ...(reason ? { "openclaw.end_reason": reason } : {}) },
      });
    } catch (error) {
      firstExportError ??= error;
    }
  }
  try {
    await endSpan(context.rootSpanId, rootStatus, backend, {
      attributes: reason ? { "openclaw.end_reason": reason } : undefined,
    });
  } catch (error) {
    firstExportError ??= error;
  }
  if (firstExportError) throw firstExportError;
  return true;
}

export function getActiveSpanCount(): number {
  return activeSpans.size;
}

export function getRecentTraceCount(): number {
  return recentTraces.size;
}

export function listRecentTraces(limit: number): Array<{
  traceId: string;
  spanCount: number;
  startTimeMs: number;
  endTimeMs?: number;
  rootSpan: string;
}> {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_RECENT_TRACES) : 50;
  return Array.from(recentTraces.entries()).slice(-safeLimit).map(([traceId, spans]) => {
    let startTimeMs = Number.POSITIVE_INFINITY;
    let endTimeMs = 0;
    let allEnded = true;
    for (const span of spans) {
      startTimeMs = Math.min(startTimeMs, span.startTimeMs);
      if (span.endTimeMs === undefined) allEnded = false;
      else endTimeMs = Math.max(endTimeMs, span.endTimeMs);
    }
    return {
      traceId,
      spanCount: spans.length,
      startTimeMs,
      endTimeMs: allEnded ? endTimeMs : undefined,
      rootSpan: spans.find((span) => !span.parentSpanId)?.name ?? "(unknown)",
    };
  });
}

export function getTraceSpans(traceId: string): Span[] | undefined {
  return recentTraces.get(traceId)?.map(cloneSpan);
}

/** TTL 清理会真正关闭 orphan spans，而不只是丢掉索引。 */
export async function cleanupSessionTraces(
  backend: TracingBackend | null,
  nowMs = Date.now(),
  ttlMs = DEFAULT_ACTIVE_TRACE_TTL_MS,
): Promise<number> {
  const contexts = new Set([...sessionTraceMap.values(), ...runTraceMap.values()]);
  let cleaned = 0;
  let firstExportError: unknown;
  for (const context of contexts) {
    if (nowMs - (context.lastTouchedAtMs ?? context.createdAtMs ?? nowMs) < ttlMs) continue;
    try {
      if (await finishActiveTrace(context.sessionKey, context.runId, "error", backend, "trace_ttl_expired")) {
        cleaned += 1;
      }
    } catch (error) {
      cleaned += 1;
      firstExportError ??= error;
    }
  }
  if (firstExportError) throw firstExportError;
  return cleaned;
}

export function resetTraceStore(): void {
  activeSpans.clear();
  recentTraces.clear();
  sessionTraceMap.clear();
  runTraceMap.clear();
  toolSpanMap.clear();
}

function cloneSpan(span: Span): Span {
  return {
    ...span,
    attributes: { ...span.attributes },
    events: span.events.map((event) => ({
      ...event,
      attributes: event.attributes ? { ...event.attributes } : undefined,
    })),
  };
}

export { activeSpans, recentTraces };
