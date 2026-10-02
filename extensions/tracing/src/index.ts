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
import { resolveStateDir } from "openclaw/plugin-sdk/state-paths";
import { FileBackend } from "./backends/file-backend.js";
import { LogBackend } from "./backends/log-backend.js";
import { OtlpBackend } from "./backends/otlp-backend.js";
import { normalizeTracingConfig } from "./config.js";
import {
  registerTracingPluginHooks,
  type TracingHookContext,
} from "./runtime/hooks.js";
import { TracingSampler } from "./runtime/sampler.js";
import { SharedTraceJournal } from "./runtime/shared-trace-journal.js";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  cleanupSessionTraces,
  finishAllActiveTraces,
  getActiveSpanCount,
  getActiveTraceCount,
  resetTraceStore,
} from "./runtime/trace-store.js";
import type {
  TracingBackend,
  TracingConfig,
  TracingLogger,
} from "./shared/types.js";
import { redactTraceText } from "./shared/redact.js";

const PLUGIN_ID = "tracing";
const SUPPORTED_BACKENDS: TracingConfig["backend"][] = ["log", "file", "otlp"];
let activeContext: TracingHookContext | null = null;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;
let initialized = false;
let initializationPromise: Promise<void> | null = null;
let stopping = false;
let lifecycleGeneration = 0;

function journalFor(config: TracingConfig): SharedTraceJournal {
  const stateDir = resolveStateDir();
  return new SharedTraceJournal(join(stateDir, "plugins", "tracing", "journal"), {
    maxSpansPerTrace: Math.min(config.maxSpansPerTrace, 100),
    retentionMs: config.traceRetentionDays * 86_400_000,
    scopeRoot: stateDir,
  });
}

/** Preserve the original export path and publish the same completed Span for Gateway queries. */
class JournalBackend implements TracingBackend {
  readonly name: string;
  private journalError: string | undefined;
  private journalFailures = 0;

  constructor(
    private readonly delegate: TracingBackend,
    private readonly journal: SharedTraceJournal,
    private readonly logger: TracingLogger,
  ) { this.name = delegate.name; }

  async init(config: TracingConfig): Promise<void> {
    await this.delegate.init(config);
    try { await this.journal.prepare(); }
    catch (error) {
      this.journalFailures += 1;
      this.journalError = toErrorMessage(error);
      this.logger.error(`[tracing] Shared trace journal recovery failed: ${this.journalError}`);
    }
  }
  async exportSpans(spans: import("./shared/types.js").Span[]): Promise<void> {
    let backendError: unknown;
    try { await this.delegate.exportSpans(spans); } catch (error) { backendError = error; }
    for (const span of spans) {
      try {
        await this.journal.writeSpan(span);
      } catch (error) {
        this.journalFailures += 1;
        this.journalError = toErrorMessage(error);
        this.logger.error(`[tracing] Shared trace journal write failed: ${this.journalError}`);
      }
    }
    if (backendError) throw backendError;
  }
  getStatus() {
    const status = this.delegate.getStatus();
    return this.journalError
      ? { ...status, healthy: false, lastError: this.journalError, journalFailures: this.journalFailures }
      : { ...status, journalFailures: 0 };
  }
  async shutdown(): Promise<void> { await this.delegate.shutdown(); }
}

function createBackend(config: TracingConfig, logger: TracingLogger): TracingBackend {
  const stateDir = resolveStateDir();
  const within = relative(stateDir, config.traceDir);
  const protectedScope = within !== ".." && !within.startsWith(`..${sep}`) && !isAbsolute(within)
    ? stateDir : undefined;
  const delegate = config.backend === "file" ? new FileBackend(logger, protectedScope)
    : config.backend === "otlp" ? new OtlpBackend(logger)
      : new LogBackend(logger);
  return new JournalBackend(delegate, journalFor(config), logger);
}

function resolveTracingConfig(api: OpenClawPluginApi): TracingConfig {
  const globalConfig = api.config as Record<string, unknown>;
  const legacy = isRecord(globalConfig.tracing) ? globalConfig.tracing : undefined;
  const plugin = isRecord(api.pluginConfig) ? api.pluginConfig : undefined;
  const config = normalizeTracingConfig(legacy, plugin);
  if (!isAbsolute(config.traceDir)) {
    const stateDir = resolveStateDir();
    const resolved = resolve(stateDir, config.traceDir);
    const within = relative(stateDir, resolved);
    if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) {
      throw new Error("relative traceDir must remain inside the OpenClaw state directory");
    }
    config.traceDir = resolved;
  }
  return config;
}

async function initTracing(api: OpenClawPluginApi): Promise<void> {
  if (stopping) return;
  if (initialized) return;
  if (initializationPromise) return initializationPromise;
  const pending = initializeTracing(api);
  initializationPromise = pending;
  try {
    await pending;
  } finally {
    if (initializationPromise === pending) initializationPromise = null;
  }
}

/** 真正执行一次初始化；外层 Promise 门闩保证 gateway_start 与首批 Hook 不会重复建后端或漏事件。 */
async function initializeTracing(api: OpenClawPluginApi): Promise<void> {
  const generation = lifecycleGeneration;
  const config = resolveTracingConfig(api);
  if (!config.enabled) {
    initialized = true;
    api.logger.info("[tracing] Disabled by configuration");
    return;
  }

  const backend = createBackend(config, api.logger);
  try {
    await backend.init(config);
    if (stopping || generation !== lifecycleGeneration) {
      // 初始化与 gateway_stop 竞态时，不得在停止完成后重新发布一个僵尸 activeContext。
      await backend.shutdown();
      return;
    }
    activeContext = {
      backend,
      sampler: new TracingSampler(config.sampleRate),
      config,
    };
    initialized = true;
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
  stopping = true;
  lifecycleGeneration += 1;
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  let firstError: unknown;
  const shutdownTimeoutMs = activeContext?.config.shutdownTimeoutMs ?? 15_000;
  try {
    await withTimeout((async () => {
      if (initializationPromise) {
        try {
          await initializationPromise;
        } catch (error) {
          firstError ??= error;
        }
      }
      const backend = activeContext?.backend ?? null;
      activeContext = null;
      initialized = false;
      try {
        if (backend) await finishAllActiveTraces(backend, "gateway_shutdown");
      } catch (error) {
        firstError ??= error;
      }
      try {
        if (backend) await backend.shutdown();
      } catch (error) {
        firstError ??= error;
      }
    })(), shutdownTimeoutMs, `Tracing shutdown timed out after ${shutdownTimeoutMs}ms`);
  } catch (error) {
    firstError ??= error;
  } finally {
    activeContext = null;
    initialized = false;
    initializationPromise = null;
    resetTraceStore();
    stopping = false;
  }
  if (firstError) throw firstError;
}

/** 为停止阶段提供总时限；底层 OTLP 自带请求 Abort，文件系统异常也不能无限阻塞 Gateway。 */
async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function statusHandler(req: IncomingMessage, res: ServerResponse, journal: SharedTraceJournal): Promise<void> {
  if (!requireGet(req, res)) return;
  const backendStatus = activeContext?.backend.getStatus();
  const healthy = backendStatus?.healthy ?? true;
  let sharedRecentTraces: number;
  try { sharedRecentTraces = await journal.count(); }
  catch (error) {
    void error;
    writeJson(res, 503, { ok: false, error: "Trace journal unavailable", data: {
      exportHealth: { scope: "gateway-runtime", healthy },
      queryHealth: { scope: "profile-journal", healthy: false, completeness: "unverified" },
    } });
    return;
  }
  writeJson(res, healthy ? 200 : 503, {
    ok: healthy,
    data: {
      plugin: PLUGIN_ID,
      status: activeContext
        ? (healthy ? "active" : "degraded")
        : initializationPromise
          ? "initializing"
          : "disabled",
      backend: activeContext?.backend.name ?? "none",
      backendStatus: backendStatus ?? null,
      exportHealth: { scope: "gateway-runtime", healthy },
      queryHealth: { scope: "profile-journal", healthy: true, completeness: "unverified" },
      sampleRate: activeContext?.sampler.getSampleRate() ?? 0,
      activeSpans: getActiveSpanCount(),
      activeTraces: getActiveTraceCount(),
      recentTraces: sharedRecentTraces,
      features: { pluginHooks: true, backends: SUPPORTED_BACKENDS },
    },
  });
}

async function tracesHandler(req: IncomingMessage, res: ServerResponse, journal: SharedTraceJournal): Promise<void> {
  if (!requireGet(req, res)) return;
  const url = requestUrl(req);
  const rawLimit = url.searchParams.get("limit");
  const parsed = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
    writeJson(res, 400, { ok: false, error: "limit must be an integer between 1 and 200" });
    return;
  }
  try { writeJson(res, 200, { ok: true, data: await journal.list(parsed) }); }
  catch (error) { writeJournalFailure(res, error); }
}

async function traceDetailHandler(req: IncomingMessage, res: ServerResponse, journal: SharedTraceJournal): Promise<void> {
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
  let spans;
  try { spans = await journal.get(traceId.toLowerCase()); }
  catch (error) { writeJournalFailure(res, error); return; }
  if (!spans) {
    writeJson(res, 404, { ok: false, error: `Trace ${traceId} not found` });
    return;
  }
  writeJson(res, 200, { ok: true, data: { traceId: traceId.toLowerCase(), spans } });
}

function writeJournalFailure(res: ServerResponse, error: unknown): void {
  // Never expose filesystem paths, raw span data or underlying OS errors through HTTP.
  void error;
  writeJson(res, 503, { ok: false, error: "Trace journal unavailable" });
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
  return redactTraceText(error instanceof Error ? error.message : String(error));
}

const plugin: OpenClawPluginDefinition = definePluginEntry({
  id: PLUGIN_ID,
  name: "openclaw-tracing",
  description: "Bounded OpenTelemetry-compatible tracing for OpenClaw message and tool lifecycles",
  register(api: OpenClawPluginApi) {
    const routeOptions = { auth: "gateway" as const, match: "exact" as const };
    const journal = journalFor(resolveTracingConfig(api));
    api.registerHttpRoute({ ...routeOptions, path: "/tracing/status", handler: (req, res) => statusHandler(req, res, journal) });
    api.registerHttpRoute({ ...routeOptions, path: "/tracing/traces", handler: (req, res) => tracesHandler(req, res, journal) });
    api.registerHttpRoute({ ...routeOptions, path: "/tracing/trace", handler: (req, res) => traceDetailHandler(req, res, journal) });
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
