/**
 * openclaw-tracing 插件入口
 *
 * 分布式追踪插件 — 捕获消息流、Agent 交互和工具调用的完整追踪链。
 * 参考 rabbitmq_tracing 设计，采用 OpenTelemetry 兼容的数据模型。
 *
 * 已实现功能：
 * - 为每条消息创建 Trace（消息到达 → Agent 处理 → 工具调用 → 响应）
 * - 支持 Log / File (JSONL + 日期轮转) / OTLP HTTP / SkyWalking 四种后端
 * - 采样率控制（基于 traceId hash 的确定性采样）
 * - 隐私保护（可选是否捕获消息体）
 * - HTTP API 查询最近 Trace
 * - Hook 集成（自动追踪 command:new, tool_result_persist, agent:bootstrap 事件）
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Span, SpanKind, SpanStatus, TracingConfig, TracingBackend, GatewayRuntime } from "./types.js";
import { LogBackend } from "./backends/log-backend.js";
import { FileBackend } from "./backends/file-backend.js";
import { OtlpBackend } from "./backends/otlp-backend.js";
import { SkyWalkingBackend } from "./backends/skywalking-backend.js";
import { TracingSampler } from "./sampler.js";
import { registerTracingHooks, getActiveSpanCount, cleanupSessionTraces } from "./hooks.js";

// ======================== Trace 存储（内存） ========================

/** 最近完成的 trace 缓存（环形缓冲） */
const recentTraces: Map<string, Span[]> = new Map();
const MAX_RECENT_TRACES = 200;

/** 活跃的 span（尚未结束） */
const activeSpans: Map<string, Span> = new Map();

// ======================== ID 生成 ========================

/**
 * 生成随机十六进制 ID
 *
 * @param bytes - 字节长度（traceId=16, spanId=8）
 */
function randomHexId(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ======================== Span 操作 ========================

/**
 * 创建一个新 Span
 *
 * @param name - 操作名称
 * @param options - Span 选项
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
 * 结束一个 Span
 *
 * @param spanId - 要结束的 Span ID
 * @param status - 最终状态
 */
function endSpan(spanId: string, status: SpanStatus = "ok"): Span | undefined {
  const span = activeSpans.get(spanId);
  if (!span) return undefined;

  span.endTimeMs = Date.now();
  span.status = status;
  activeSpans.delete(spanId);

  // 添加到 recent traces
  const existing = recentTraces.get(span.traceId) ?? [];
  existing.push(span);
  recentTraces.set(span.traceId, existing);

  // 限制 recent traces 数量
  if (recentTraces.size > MAX_RECENT_TRACES) {
    const oldest = recentTraces.keys().next().value;
    if (oldest) recentTraces.delete(oldest);
  }

  return span;
}

// ======================== HTTP 处理器 ========================

/**
 * 处理追踪状态查询
 */
function statusHandler(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      ok: true,
      data: {
        plugin: "openclaw-tracing",
        status: activeBackend ? "active" : "disabled",
        backend: activeBackend?.name ?? "none",
        sampleRate: sampler?.getSampleRate() ?? 0,
        activeSpans: activeSpans.size,
        hookActiveSpans: getActiveSpanCount(),
        recentTraces: recentTraces.size,
        features: {
          logBackend: true,
          fileBackend: true,
          otlpBackend: true,
          skywalkingBackend: true,
          hookIntegration: true,
          sampling: true,
        },
      },
    })
  );
}

/**
 * 查询最近的 Trace 列表
 */
function tracesHandler(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);

  const traces = Array.from(recentTraces.entries())
    .slice(-limit)
    .map(([traceId, spans]) => ({
      traceId,
      spanCount: spans.length,
      startTimeMs: Math.min(...spans.map((s) => s.startTimeMs)),
      endTimeMs: spans.every((s) => s.endTimeMs)
        ? Math.max(...spans.map((s) => s.endTimeMs!))
        : undefined,
      rootSpan: spans.find((s) => !s.parentSpanId)?.name ?? "(unknown)",
    }));

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, data: traces }));
}

/**
 * 查询单个 Trace 详情
 */
function traceDetailHandler(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const traceId = url.searchParams.get("traceId");

  if (!traceId) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "traceId query parameter required" }));
    return;
  }

  const spans = recentTraces.get(traceId);
  if (!spans) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: `Trace ${traceId} not found` }));
    return;
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, data: { traceId, spans } }));
}

// ======================== 后端实例（模块级） ========================

/** 当前活跃的追踪后端 */
let activeBackend: TracingBackend | null = null;

/** 采样器实例 */
let sampler: TracingSampler | null = null;

/** 内存清理定时器 */
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 合并全局 `config.tracing` 与插件清单配置 `pluginConfig`（后者优先）
 */
function resolveTracingConfig(api: {
  config: unknown;
  pluginConfig?: Record<string, unknown>;
}): Partial<TracingConfig> {
  const globalCfg = api.config as Record<string, unknown>;
  const legacy = globalCfg?.tracing as Partial<TracingConfig> | undefined;
  const plugin = (api.pluginConfig ?? {}) as Partial<TracingConfig>;
  return { ...legacy, ...plugin };
}

/**
 * 根据配置创建追踪后端
 *
 * @param backendType - 后端类型
 * @returns 后端实例
 */
function createBackend(backendType: string): TracingBackend {
  switch (backendType) {
    case "file":
      return new FileBackend();
    case "otlp":
      return new OtlpBackend();
    case "skywalking":
      return new SkyWalkingBackend();
    case "log":
    default:
      return new LogBackend();
  }
}

// ======================== 插件注册 ========================

export default function register(api: {
  runtime: unknown;
  config: unknown;
  pluginConfig?: Record<string, unknown>;
  registerHttpRoute: (params: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void }) => void;
  registerService?: (service: { id: string; start: () => Promise<void>; stop?: () => Promise<void> }) => void;
}): void {
    api.registerHttpRoute({ path: "/tracing/status", handler: statusHandler });
    api.registerHttpRoute({ path: "/tracing/traces", handler: tracesHandler });
    api.registerHttpRoute({ path: "/tracing/trace", handler: traceDetailHandler });

    const initTracing = async () => {
      const tracingConfig = resolveTracingConfig(api);

      const enabled = tracingConfig?.enabled ?? false;
      const backendType = tracingConfig?.backend ?? "log";
      const sampleRate = tracingConfig?.sampleRate ?? 1.0;
      const captureBody = tracingConfig?.captureMessageBody ?? false;

      console.log(
        `[openclaw-tracing] Tracing ${enabled ? "ENABLED" : "DISABLED"} | ` +
          `Backend: ${backendType} | Sample rate: ${sampleRate}`,
      );

      if (!enabled) {
        console.log("[openclaw-tracing] Tracing is disabled. Set enabled in plugin config or config.tracing.");
        return;
      }

      const fullConfig: TracingConfig = {
        enabled: true,
        backend: backendType as TracingConfig["backend"],
        otlpEndpoint: tracingConfig?.otlpEndpoint ?? "http://localhost:4318",
        sampleRate,
        traceDir: tracingConfig?.traceDir ?? "./traces",
        maxSpansPerTrace: tracingConfig?.maxSpansPerTrace ?? 100,
        captureMessageBody: captureBody,
        skywalkingServiceName: tracingConfig?.skywalkingServiceName,
        skywalkingServiceInstance: tracingConfig?.skywalkingServiceInstance,
        skywalkingCollectorAddress: tracingConfig?.skywalkingCollectorAddress,
      };

      activeBackend = createBackend(backendType);
      await activeBackend.init(fullConfig);

      sampler = new TracingSampler(sampleRate);

      registerTracingHooks(api.runtime as unknown as GatewayRuntime, activeBackend, sampler, captureBody);

      cleanupTimer = setInterval(() => {
        cleanupSessionTraces();
      }, 60_000);

      console.log("[openclaw-tracing] Tracing fully initialized");
    };

    const registerService = api.registerService;
    if (typeof registerService === "function") {
      registerService({
      id: "openclaw-tracing-init",
      start: async () => {
        await initTracing();
      },
      stop: async () => {
        if (cleanupTimer) {
          clearInterval(cleanupTimer);
          cleanupTimer = null;
        }
        if (activeBackend) {
          await activeBackend.shutdown();
          activeBackend = null;
        }
      },
      });
    } else {
      void initTracing();
    }

    console.log("[openclaw-tracing] Plugin registered — distributed tracing");
    console.log("[openclaw-tracing] Endpoints:");
    console.log("  /tracing/status  — Tracing status & config");
    console.log("  /tracing/traces  — Recent trace list");
    console.log("  /tracing/trace   — Single trace detail");
}

// 处理进程退出，刷新后端缓冲
process.on("SIGTERM", async () => {
  if (cleanupTimer) clearInterval(cleanupTimer);
  if (activeBackend) {
    await activeBackend.shutdown();
  }
});

// 导出供外部使用的追踪 API
export { createSpan, endSpan, recentTraces, activeSpans };
export type { Span, SpanKind, SpanStatus, TracingConfig };
