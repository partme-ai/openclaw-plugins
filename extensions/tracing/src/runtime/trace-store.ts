/**
 * @fileoverview 活动 Trace、Span 与 Tool Call 关联的有界进程内状态机。
 *
 * 同时按 sessionKey 和 runId 定位活动 Trace，按 toolCallId 关联子 Span；结束时先固化并导出
 * 悬挂子 Span，再结束根 Span并清除全部索引。近期 Trace 使用 200 条 LRU 风格上限，TTL 清理
 * 会把 orphan Span 以 error 状态真正关闭，而不是只删除映射。
 */
import type { Span, SpanKind, SpanStatus, TracingBackend } from "../shared/types.js";
import { sanitizeTraceAttributes } from "../shared/redact.js";

/** 活动 Trace 的轻量索引，同时由 sessionKey 和 runId 指向同一对象。 */
export interface ActiveTraceContext {
  traceId: string;
  rootSpanId: string;
  spanCount: number;
  sessionKey?: string;
  runId?: string;
  createdAtMs?: number;
  lastTouchedAtMs?: number;
}

/** 结束 Span 时可覆盖的计时和最终属性；属性会在导出前复制固化。 */
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

/** 使用 Web Crypto CSPRNG 生成指定字节数的小写十六进制 Trace/Span ID。 */
export function randomHexId(bytes: number): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array, (value) => value.toString(16).padStart(2, "0")).join("");
}

/** 创建活动 Span 并登记到进程内有界生命周期状态机。 */
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
    // TraceStore 是所有查询与导出后端的共同上游，在此统一脱敏并复制属性。
    attributes: sanitizeTraceAttributes(options.attributes),
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
  if (options.attributes) Object.assign(span.attributes, sanitizeTraceAttributes(options.attributes));
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

/** 将同一 Trace 绑定到可用的 sessionKey/runId，并刷新其活动时间。 */
export function registerActiveTrace(ctx: ActiveTraceContext): void {
  const now = Date.now();
  ctx.createdAtMs ??= now;
  ctx.lastTouchedAtMs = now;
  if (ctx.sessionKey) sessionTraceMap.set(ctx.sessionKey, ctx);
  if (ctx.runId) runTraceMap.set(ctx.runId, ctx);
}

/** 优先按 runId、其次按 sessionKey 定位活动 Trace，并刷新 TTL 活跃时间。 */
export function resolveActiveTrace(sessionKey?: string, runId?: string): ActiveTraceContext | undefined {
  const context = (runId ? runTraceMap.get(runId) : undefined)
    ?? (sessionKey ? sessionTraceMap.get(sessionKey) : undefined);
  if (context) context.lastTouchedAtMs = Date.now();
  return context;
}

/** 在单 Trace 上限内预留一个 Span 名额；超过上限返回 false 以阻止无界增长。 */
export function incrementSpanCount(active: ActiveTraceContext, maxSpansPerTrace: number): boolean {
  active.lastTouchedAtMs = Date.now();
  if (active.spanCount >= maxSpansPerTrace) return false;
  active.spanCount += 1;
  return true;
}

/** 从 session/run 两类索引中原子式移除同一个活动 Trace 上下文。 */
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

/** 将 OpenClaw toolCallId 绑定到对应子 Span，供 after_tool_call 精确收尾。 */
export function bindToolSpan(toolCallId: string, spanId: string, traceId: string): void {
  toolSpanMap.set(toolCallId, { spanId, traceId });
}

/** 一次性取出并删除工具 Span 绑定，避免重复 after hook 二次结束同一 Span。 */
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

/**
 * Gateway 停止前关闭并导出全部活动 Trace 与无索引孤儿 Span。
 *
 * 每个未完成 Span 都标记为 error；单个后端导出失败不会阻止其余 Span 回收，最后再抛出首个
 * 错误，使调用方仍能执行后端 shutdown，同时保留故障可见性。
 */
export async function finishAllActiveTraces(
  backend: TracingBackend | null,
  reason = "gateway_shutdown",
): Promise<number> {
  const contexts = new Set([...sessionTraceMap.values(), ...runTraceMap.values()]);
  let finished = 0;
  let firstExportError: unknown;
  for (const context of contexts) {
    try {
      if (await finishActiveTrace(context.sessionKey, context.runId, "error", backend, reason)) finished += 1;
    } catch (error) {
      finished += 1;
      firstExportError ??= error;
    }
  }
  for (const spanId of [...activeSpans.keys()]) {
    try {
      await endSpan(spanId, "error", backend, { attributes: { "openclaw.end_reason": reason } });
    } catch (error) {
      firstExportError ??= error;
    }
  }
  toolSpanMap.clear();
  if (firstExportError) throw firstExportError;
  return finished;
}

/** 返回当前尚未结束的 Span 数，用于状态接口和泄漏监控。 */
export function getActiveSpanCount(): number {
  return activeSpans.size;
}

/** 返回去重后的活动 Trace 数；同一上下文可能同时存在 session/run 两个索引。 */
export function getActiveTraceCount(): number {
  return new Set([...sessionTraceMap.values(), ...runTraceMap.values()]).size;
}

/** 返回进程内近期 Trace 数；该存储最多保留 200 条。 */
export function getRecentTraceCount(): number {
  return recentTraces.size;
}

/** 按最近写入顺序返回有界 Trace 摘要，不暴露可变的内部 Span 对象。 */
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

/** 返回指定 Trace 的深复制 Span 列表，防止状态接口调用方修改内部缓存。 */
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

/** 清空所有活动与近期索引；仅供生命周期最终清理和测试隔离使用。 */
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
