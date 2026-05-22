/**
 * openclaw-tracing 插件入口
 *
 * 分布式追踪 — 基于 OpenClaw Plugin Hooks（api.on）捕获消息流与工具调用。
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

import { LogBackend } from "./backends/log-backend.js";
import { FileBackend } from "./backends/file-backend.js";
import { OtlpBackend } from "./backends/otlp-backend.js";
import { SkyWalkingBackend } from "./backends/skywalking-backend.js";
import { registerTracingPluginHooks } from "./hooks.js";
import { TracingSampler } from "./sampler.js";
import type { TracingBackend, TracingConfig } from "./types.js";
import {
  cleanupSessionTraces,
  getActiveSpanCount,
  getRecentTraceCount,
  getTraceSpans,
  listRecentTraces,
  resetTraceStore,
} from "./trace-store.js";

const PLUGIN_ID = "openclaw-tracing";

/** 当前活跃的追踪后端 */
let activeBackend: TracingBackend | null = null;

/** 采样器实例 */
let sampler: TracingSampler | null = null;

/** 内存清理定时器 */
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/** 是否已完成 tracing 初始化 */
let tracingInitialized = false;

/**
 * 合并全局 config.tracing 与 pluginConfig（后者优先）。
 */
function resolveTracingConfig(api: OpenClawPluginApi): Partial<TracingConfig> {
  const globalCfg = api.config as Record<string, unknown>;
  const legacy = globalCfg?.tracing as Partial<TracingConfig> | undefined;
  const plugin = (api.pluginConfig ?? {}) as Partial<TracingConfig>;
  return { ...legacy, ...plugin };
}

/**
 * 根据配置创建追踪后端。
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

/**
 * 停止 tracing 并释放资源。
 */
async function shutdownTracing(): Promise<void> {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  if (activeBackend) {
    await activeBackend.shutdown();
    activeBackend = null;
  }
  sampler = null;
  tracingInitialized = false;
  resetTraceStore();
}

/**
 * 初始化 tracing 后端、采样器与 plugin hooks。
 */
async function initTracing(api: OpenClawPluginApi): Promise<void> {
  if (tracingInitialized) {
    return;
  }

  const tracingConfig = resolveTracingConfig(api);
  const enabled = tracingConfig?.enabled ?? false;
  const backendType = tracingConfig?.backend ?? "log";
  const sampleRate = tracingConfig?.sampleRate ?? 1.0;
  const captureBody = tracingConfig?.captureMessageBody ?? false;

  api.logger.info(
    `[openclaw-tracing] Tracing ${enabled ? "ENABLED" : "DISABLED"} | Backend: ${backendType} | Sample rate: ${sampleRate}`,
  );

  if (!enabled) {
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

  registerTracingPluginHooks(api, {
    backend: activeBackend,
    sampler,
    config: fullConfig,
  });

  cleanupTimer = setInterval(() => {
    cleanupSessionTraces();
  }, 60_000);

  tracingInitialized = true;
  api.logger.info("[openclaw-tracing] Tracing fully initialized");
}

function statusHandler(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      ok: true,
      data: {
        plugin: PLUGIN_ID,
        status: activeBackend ? "active" : "disabled",
        backend: activeBackend?.name ?? "none",
        sampleRate: sampler?.getSampleRate() ?? 0,
        activeSpans: getActiveSpanCount(),
        recentTraces: getRecentTraceCount(),
        features: {
          pluginHooks: true,
          backends: ["log", "file", "otlp", "skywalking"],
        },
      },
    }),
  );
}

function tracesHandler(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, data: listRecentTraces(limit) }));
}

function traceDetailHandler(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const traceId = url.searchParams.get("traceId");

  if (!traceId) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "traceId query parameter required" }));
    return;
  }

  const spans = getTraceSpans(traceId);
  if (!spans) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: `Trace ${traceId} not found` }));
    return;
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, data: { traceId, spans } }));
}

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "openclaw-tracing",
  description: "Distributed tracing for OpenClaw — Plugin Hooks based message and tool span capture",
  register(api: OpenClawPluginApi) {
    const routeOpts = { auth: "plugin" as const };
    api.registerHttpRoute({ ...routeOpts, path: "/tracing/status", handler: statusHandler });
    api.registerHttpRoute({ ...routeOpts, path: "/tracing/traces", handler: tracesHandler });
    api.registerHttpRoute({ ...routeOpts, path: "/tracing/trace", handler: traceDetailHandler });

    api.on("gateway_start", async () => {
      await initTracing(api);
    });

    api.on("gateway_stop", async () => {
      await shutdownTracing();
      api.logger.info("[openclaw-tracing] Tracing shut down on gateway_stop");
    });

    api.logger.info("[openclaw-tracing] Plugin registered — awaiting gateway_start");
  },
});

export type { Span, SpanKind, SpanStatus, TracingConfig } from "./types.js";
