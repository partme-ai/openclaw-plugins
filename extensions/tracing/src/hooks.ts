/**
 * Gateway 事件 Hook 集成
 * 注册到 Gateway 事件系统，自动为关键操作创建追踪 Span
 *
 * 追踪的事件：
 * - command:new       → 创建 root span（消息到达）
 * - tool_result_persist → 创建 tool call child span
 * - agent:bootstrap   → 创建 agent invocation span
 *
 * 每个事件产生的 Span 通过 traceId 关联为完整的追踪链
 */

import type { Span, SpanKind, SpanStatus, GatewayRuntime, TracingBackend } from "./types.js";
import { TracingSampler } from "./sampler.js";
import { buildSessionKeyFromDmScope } from "./dm-scope.js";

/** 活跃 Span 存储：spanId → Span */
const activeSpans = new Map<string, Span>();

/** 会话到 traceId 映射：sessionKey → traceId（跨事件关联） */
const sessionTraceMap = new Map<string, string>();

/**
 * 生成随机十六进制 ID
 *
 * @param bytes - 字节长度
 * @returns 十六进制字符串
 */
function randomHexId(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 创建 Span
 *
 * @param name - 操作名称
 * @param options - Span 配置
 * @returns 新创建的 Span
 */
function createSpan(
  name: string,
  options: {
    traceId?: string;
    parentSpanId?: string;
    kind?: SpanKind;
    attributes?: Record<string, string | number | boolean>;
  } = {}
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
 * 结束 Span 并导出
 *
 * @param spanId - Span ID
 * @param status - 结束状态
 * @param backend - 追踪后端
 */
async function endSpan(
  spanId: string,
  status: SpanStatus,
  backend: TracingBackend | null
): Promise<void> {
  const span = activeSpans.get(spanId);
  if (!span) return;

  span.endTimeMs = Date.now();
  span.status = status;
  activeSpans.delete(spanId);

  // 导出到后端
  if (backend) {
    try {
      await backend.exportSpans([span]);
    } catch (err) {
      console.error("[openclaw-tracing] Span export failed:", err);
    }
  }
}

/**
 * 注册 Gateway 事件 Hook
 * 将追踪 Span 创建/结束绑定到 Gateway 事件系统
 *
 * @param runtime - Gateway Runtime
 * @param backend - 追踪后端
 * @param sampler - 采样器
 * @param captureBody - 是否捕获消息体
 */
export function registerTracingHooks(
  runtime: GatewayRuntime,
  backend: TracingBackend,
  sampler: TracingSampler,
  captureBody: boolean = false
): void {
  const runtimeAny = runtime as unknown as Record<string, unknown>;

  // 检查是否有事件注册 API
  const onEvent = runtimeAny.on as ((event: string, handler: (...args: unknown[]) => void) => void) | undefined
    ?? runtimeAny.addListener as ((event: string, handler: (...args: unknown[]) => void) => void) | undefined;

  if (typeof onEvent !== "function") {
    console.warn(
      "[openclaw-tracing] Gateway runtime does not expose event listener API. " +
      "Hook integration skipped. Events will need to be manually instrumented."
    );
    return;
  }

  // ──────────── command:new → Root Span ────────────
  onEvent("command:new", (...args: unknown[]) => {
    const event = (args[0] ?? {}) as Record<string, unknown>;
    const runtimeConfig = (runtimeAny.config as Record<string, unknown>) ?? {};
    
    // 基于 dmScope 生成统一会话键
    const sessionKey = buildSessionKeyFromDmScope({
      cfg: runtimeConfig,
      agentId: (event.agentId as string) ?? "main",
      channel: (event.channel as string) ?? "unknown",
      accountId: (event.accountId as string) ?? "default",
      peerId: (event.from as string) ?? "unknown",
    });
    
    const traceId = randomHexId(16);

    // 采样决策
    if (!sampler.shouldSample(traceId)) return;

    // 关联 session → traceId
    sessionTraceMap.set(sessionKey, traceId);

    const span = createSpan("command:new", {
      traceId,
      kind: "server",
      attributes: {
        "openclaw.session_key": sessionKey,
        "openclaw.channel": (event.channel as string) ?? "unknown",
        "openclaw.from": (event.from as string) ?? "unknown",
        ...(captureBody && event.text
          ? { "openclaw.message_text": String(event.text).slice(0, 500) }
          : {}),
      },
    });

    // 将 spanId 存入事件对象，供后续 hook 使用
    (event as Record<string, unknown>)._rootSpanId = span.spanId;
  });

  // ──────────── agent:bootstrap → Agent Invocation Span ────────────
  onEvent("agent:bootstrap", (...args: unknown[]) => {
    const event = (args[0] ?? {}) as Record<string, unknown>;
    const runtimeConfig = (runtimeAny.config as Record<string, unknown>) ?? {};
    
    // 基于 dmScope 生成统一会话键
    const sessionKey = buildSessionKeyFromDmScope({
      cfg: runtimeConfig,
      agentId: (event.agentId as string) ?? "main",
      channel: (event.channel as string) ?? "unknown",
      accountId: (event.accountId as string) ?? "default",
      peerId: (event.from as string) ?? "unknown",
    });
    
    const traceId = sessionTraceMap.get(sessionKey);
    if (!traceId) return; // 未采样

    const agentId = event.agentId as string ?? "unknown";

    createSpan("agent:bootstrap", {
      traceId,
      parentSpanId: event._rootSpanId as string | undefined,
      kind: "internal",
      attributes: {
        "openclaw.agent_id": agentId,
        "openclaw.session_key": sessionKey,
      },
    });
  });

  // ──────────── tool_result_persist → Tool Call Span ────────────
  onEvent("tool_result_persist", (...args: unknown[]) => {
    const event = (args[0] ?? {}) as Record<string, unknown>;
    const runtimeConfig = (runtimeAny.config as Record<string, unknown>) ?? {};
    
    // 基于 dmScope 生成统一会话键
    const sessionKey = buildSessionKeyFromDmScope({
      cfg: runtimeConfig,
      agentId: (event.agentId as string) ?? "main",
      channel: (event.channel as string) ?? "unknown",
      accountId: (event.accountId as string) ?? "default",
      peerId: (event.from as string) ?? "unknown",
    });
    
    const traceId = sessionTraceMap.get(sessionKey);
    if (!traceId) return; // 未采样

    const toolName = event.toolName as string ?? "unknown";
    const durationMs = event.durationMs as number | undefined;

    const span = createSpan(`tool:${toolName}`, {
      traceId,
      kind: "client",
      attributes: {
        "openclaw.tool_name": toolName,
        "openclaw.session_key": sessionKey,
        "openclaw.tool_status": (event.status as string) ?? "ok",
      },
    });

    // 工具调用已完成，直接结束 Span
    if (durationMs) {
      span.startTimeMs = Date.now() - durationMs;
    }
    endSpan(span.spanId, (event.status as string) === "error" ? "error" : "ok", backend);
  });

  console.log("[openclaw-tracing] Gateway event hooks registered");
}

/**
 * 获取活跃 Span 数量
 */
export function getActiveSpanCount(): number {
  return activeSpans.size;
}

/**
 * 清理过期的 session trace 映射
 * 防止内存泄漏
 */
export function cleanupSessionTraces(): void {
  // 限制映射数量
  if (sessionTraceMap.size > 10000) {
    const keysToDelete = Array.from(sessionTraceMap.keys()).slice(0, 5000);
    for (const key of keysToDelete) {
      sessionTraceMap.delete(key);
    }
  }
}
