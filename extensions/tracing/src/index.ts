/**
 * @fileoverview OpenClaw 消息与工具全链路追踪插件的注册和生命周期入口。
 *
 * 根据配置选择 log/file/OTLP 后端，注册消息与 Tool hooks，并维护有界近期 Trace 查询接口。
 * Hook Runtime 可能与 Gateway Runtime 隔离，因此上下文既在 gateway_start 初始化，也允许
 * Hook 首次调用时惰性初始化；停止时关闭 orphan Trace、排空后端并清理定时器。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  definePluginEntry,
  type OpenClawPluginDefinition,
} from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { FileBackend } from "./backends/file-backend.js";
import { LogBackend } from "./backends/log-backend.js";
import { OtlpBackend } from "./backends/otlp-backend.js";
import { normalizeTracingConfig } from "./config.js";
import {
  registerTracingPluginHooks,
  type TracingHookContext,
} from "./runtime/hooks.js";
import { TracingSampler } from "./runtime/sampler.js";
import {
  cleanupSessionTraces,
  getActiveSpanCount,
  getRecentTraceCount,
  getTraceSpans,
  listRecentTraces,
  resetTraceStore,
} from "./runtime/trace-store.js";
import type {
  TracingBackend,
  TracingConfig,
  TracingLogger,
} from "./shared/types.js";

const PLUGIN_ID = "tracing";
const SUPPORTED_BACKENDS: TracingConfig["backend"][] = ["log", "file", "otlp"];
let activeContext: TracingHookContext | null = null;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;
let initialized = false;

function createBackend(type: TracingConfig["backend"], logger: TracingLogger): TracingBackend {
  if (type === "file") return new FileBackend(logger);
  if (type === "otlp") return new OtlpBackend(logger);
  return new LogBackend(logger);
}

function resolveTracingConfig(api: OpenClawPluginApi): TracingConfig {
  const globalConfig = api.config as Record<string, unknown>;
  const legacy = isRecord(globalConfig.tracing) ? globalConfig.tracing : undefined;
  const plugin = isRecord(api.pluginConfig) ? api.pluginConfig : undefined;
  return normalizeTracingConfig(legacy, plugin);
}

async function initTracing(api: OpenClawPluginApi): Promise<void> {
  if (initialized) return;
  const config = resolveTracingConfig(api);
  initialized = true;
  if (!config.enabled) {
    api.logger.info("[tracing] Disabled by configuration");
    return;
  }

  const backend = createBackend(config.backend, api.logger);
  try {
    await backend.init(config);
    activeContext = {
      backend,
      sampler: new TracingSampler(config.sampleRate),
      config,
    };
    cleanupTimer = setInterval(() => {
      void cleanupSessionTraces(backend).then((count) => {
        if (count > 0) api.logger.warn(`[tracing] Closed ${count} expired active traces`);
      }).catch((error: unknown) => {
        api.logger.error(`[tracing] Active trace cleanup failed: ${toErrorMessage(error)}`);
      });
    }, 60_000);
    cleanupTimer.unref?.();
    api.logger.info(
      `[tracing] Enabled | backend=${config.backend} | sampleRate=${config.sampleRate} | captureBody=${config.captureMessageBody}`,
    );
  } catch (error) {
    initialized = false;
    try {
      await backend.shutdown();
    } catch {
      // Initialization failure is the primary error.
    }
    throw error;
  }
}

async function shutdownTracing(): Promise<void> {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  const backend = activeContext?.backend ?? null;
  activeContext = null;
  initialized = false;
  try {
    if (backend) await backend.shutdown();
  } finally {
    resetTraceStore();
  }
}

function statusHandler(req: IncomingMessage, res: ServerResponse): void {
  if (!requireGet(req, res)) return;
  const backendStatus = activeContext?.backend.getStatus();
  const healthy = backendStatus?.healthy ?? true;
  writeJson(res, healthy ? 200 : 503, {
    ok: healthy,
    data: {
      plugin: PLUGIN_ID,
      status: activeContext ? (healthy ? "active" : "degraded") : "disabled",
      backend: activeContext?.backend.name ?? "none",
      backendStatus: backendStatus ?? null,
      sampleRate: activeContext?.sampler.getSampleRate() ?? 0,
      activeSpans: getActiveSpanCount(),
      recentTraces: getRecentTraceCount(),
      features: { pluginHooks: true, backends: SUPPORTED_BACKENDS },
    },
  });
}

function tracesHandler(req: IncomingMessage, res: ServerResponse): void {
  if (!requireGet(req, res)) return;
  const url = requestUrl(req);
  const rawLimit = url.searchParams.get("limit");
  const parsed = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
    writeJson(res, 400, { ok: false, error: "limit must be an integer between 1 and 200" });
    return;
  }
  writeJson(res, 200, { ok: true, data: listRecentTraces(parsed) });
}

function traceDetailHandler(req: IncomingMessage, res: ServerResponse): void {
  if (!requireGet(req, res)) return;
  const traceId = requestUrl(req).searchParams.get("traceId")?.trim();
  if (!traceId) {
    writeJson(res, 400, { ok: false, error: "traceId query parameter required" });
    return;
  }
  if (!/^[a-fA-F0-9]{32}$/.test(traceId)) {
    writeJson(res, 400, { ok: false, error: "traceId must be a 32 character hexadecimal ID" });
    return;
  }
  const spans = getTraceSpans(traceId);
  if (!spans) {
    writeJson(res, 404, { ok: false, error: `Trace ${traceId} not found` });
    return;
  }
  writeJson(res, 200, { ok: true, data: { traceId, spans } });
}

function requireGet(req: IncomingMessage, res: ServerResponse): boolean {
  if ((req.method ?? "GET").toUpperCase() === "GET") return true;
  res.setHeader("Allow", "GET");
  writeJson(res, 405, { ok: false, error: "Method not allowed" });
  return false;
}

function requestUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const plugin: OpenClawPluginDefinition = definePluginEntry({
  id: PLUGIN_ID,
  name: "openclaw-tracing",
  description: "Bounded OpenTelemetry-compatible tracing for OpenClaw message and tool lifecycles",
  register(api: OpenClawPluginApi) {
    const routeOptions = { auth: "plugin" as const, match: "exact" as const };
    api.registerHttpRoute({ ...routeOptions, path: "/tracing/status", handler: statusHandler });
    api.registerHttpRoute({ ...routeOptions, path: "/tracing/traces", handler: tracesHandler });
    api.registerHttpRoute({ ...routeOptions, path: "/tracing/trace", handler: traceDetailHandler });
    // OpenClaw 2026.7.1 loads hook registries in scoped plugin-runtime
    // instances that do not receive the Gateway instance's gateway_start
    // state. Initialize lazily inside each hook runtime so message/tool hooks
    // never observe a permanently empty module-local context.
    registerTracingPluginHooks(api, async () => {
      await initTracing(api);
      return activeContext;
    });
    api.on("gateway_start", async () => initTracing(api));
    api.on("gateway_stop", async () => {
      await shutdownTracing();
      api.logger.info("[tracing] Shut down on gateway_stop");
    });
    api.logger.info("[tracing] Plugin registered; awaiting gateway_start");
  },
});

export default plugin;
export { normalizeOtlpEndpoint, normalizeTracingConfig } from "./config.js";
export type { Span, SpanKind, SpanStatus, TracingConfig } from "./shared/types.js";
