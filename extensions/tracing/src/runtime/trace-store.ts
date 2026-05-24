/**
 * 内存 Trace 存储与 Span 生命周期管理。
 */

import type { Span, SpanKind, SpanStatus, TracingBackend } from "../shared/types.js";

/** 单会话 / run 的活跃 trace 上下文 */
export interface ActiveTraceContext {
  traceId: string;
  rootSpanId: string;
  spanCount: number;
  sessionKey?: string;
  runId?: string;
}

/** 最近完成的 trace 缓存（环形缓冲） */
const recentTraces = new Map<string, Span[]>();
const MAX_RECENT_TRACES = 200;

/** 活跃 span：spanId → Span */
const activeSpans = new Map<string, Span>();

/** sessionKey → ActiveTraceContext */
const sessionTraceMap = new Map<string, ActiveTraceContext>();

/** runId → ActiveTraceContext（优先于 sessionKey） */
const runTraceMap = new Map<string, ActiveTraceContext>();

/** toolCallId → spanId */
const toolSpanMap = new Map<string, string>();

/**
 * 生成随机十六进制 ID。
 *
 * @param bytes - 字节长度（traceId=16, spanId=8）
 */
export function randomHexId(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 创建 Span 并登记为活跃。
 */
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
    attributes: options.attributes ?? {},
    status: "unset",
    events: [],
  };

  activeSpans.set(span.spanId, span);
  return span;
}

/**
 * 结束 Span，写入 recentTraces，并可选导出到后端。
 */
export async function endSpan(
  spanId: string,
  status: SpanStatus,
  backend: TracingBackend | null,
): Promise<Span | undefined> {
  const span = activeSpans.get(spanId);
  if (!span) {
    return undefined;
  }

  span.endTimeMs = Date.now();
  span.status = status;
  activeSpans.delete(spanId);

  const existing = recentTraces.get(span.traceId) ?? [];
  existing.push(span);
  recentTraces.set(span.traceId, existing);

  if (recentTraces.size > MAX_RECENT_TRACES) {
    const oldest = recentTraces.keys().next().value;
    if (oldest) {
      recentTraces.delete(oldest);
    }
  }

  if (backend) {
    try {
      await backend.exportSpans([span]);
    } catch (err) {
      console.error("[openclaw-tracing] Span export failed:", err);
    }
  }

  return span;
}

/**
 * 注册活跃 trace 上下文。
 */
export function registerActiveTrace(ctx: ActiveTraceContext): void {
  if (ctx.sessionKey) {
    sessionTraceMap.set(ctx.sessionKey, ctx);
  }
  if (ctx.runId) {
    runTraceMap.set(ctx.runId, ctx);
  }
}

/**
 * 按 runId 或 sessionKey 查找活跃 trace。
 */
export function resolveActiveTrace(sessionKey?: string, runId?: string): ActiveTraceContext | undefined {
  if (runId) {
    const byRun = runTraceMap.get(runId);
    if (byRun) {
      return byRun;
    }
  }
  if (sessionKey) {
    return sessionTraceMap.get(sessionKey);
  }
  return undefined;
}

/**
 * 递增 trace 内 span 计数；超过上限时返回 false。
 */
export function incrementSpanCount(active: ActiveTraceContext, maxSpansPerTrace: number): boolean {
  active.spanCount += 1;
  return active.spanCount <= maxSpansPerTrace;
}

/**
 * 清理指定会话 / run 的 trace 映射。
 */
export function clearActiveTrace(sessionKey?: string, runId?: string): void {
  if (runId) {
    runTraceMap.delete(runId);
  }
  if (sessionKey) {
    sessionTraceMap.delete(sessionKey);
  }
}

/**
 * 绑定 toolCallId 与 spanId。
 */
export function bindToolSpan(toolCallId: string, spanId: string): void {
  toolSpanMap.set(toolCallId, spanId);
}

/**
 * 取出并移除 toolCallId 对应的 spanId。
 */
export function takeToolSpanId(toolCallId: string): string | undefined {
  const spanId = toolSpanMap.get(toolCallId);
  if (spanId) {
    toolSpanMap.delete(toolCallId);
  }
  return spanId;
}

/** 获取活跃 Span 数量 */
export function getActiveSpanCount(): number {
  return activeSpans.size;
}

/** 获取 recent traces 数量 */
export function getRecentTraceCount(): number {
  return recentTraces.size;
}

/** 列出最近 trace 摘要 */
export function listRecentTraces(limit: number): Array<{
  traceId: string;
  spanCount: number;
  startTimeMs: number;
  endTimeMs?: number;
  rootSpan: string;
}> {
  return Array.from(recentTraces.entries())
    .slice(-limit)
    .map(([traceId, spans]) => ({
      traceId,
      spanCount: spans.length,
      startTimeMs: Math.min(...spans.map((s) => s.startTimeMs)),
      endTimeMs: spans.every((s) => s.endTimeMs) ? Math.max(...spans.map((s) => s.endTimeMs!)) : undefined,
      rootSpan: spans.find((s) => !s.parentSpanId)?.name ?? "(unknown)",
    }));
}

/** 获取单个 trace 的 spans */
export function getTraceSpans(traceId: string): Span[] | undefined {
  return recentTraces.get(traceId);
}

/**
 * 清理过期映射，防止内存泄漏。
 */
export function cleanupSessionTraces(): void {
  if (sessionTraceMap.size > 10_000) {
    const keysToDelete = Array.from(sessionTraceMap.keys()).slice(0, 5_000);
    for (const key of keysToDelete) {
      sessionTraceMap.delete(key);
    }
  }
  if (runTraceMap.size > 10_000) {
    const keysToDelete = Array.from(runTraceMap.keys()).slice(0, 5_000);
    for (const key of keysToDelete) {
      runTraceMap.delete(key);
    }
  }
  if (toolSpanMap.size > 20_000) {
    const keysToDelete = Array.from(toolSpanMap.keys()).slice(0, 10_000);
    for (const key of keysToDelete) {
      toolSpanMap.delete(key);
    }
  }
}

/**
 * Gateway 停止或插件卸载时清空全部内存状态。
 */
export function resetTraceStore(): void {
  activeSpans.clear();
  sessionTraceMap.clear();
  runTraceMap.clear();
  toolSpanMap.clear();
}

export { activeSpans, recentTraces };
