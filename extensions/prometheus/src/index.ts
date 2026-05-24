/**
 * @fileoverview openclaw-prometheus 插件入口（infra Profile）。
 *
 * @description
 * 注册指标采集器、HTTP scrape 路由与 Gateway RPC 扩展；无 messaging 入出站。
 * 指标端点由 plugin 内 scrapeAuth 可选保护。
 *
 * @module index
 */

import type {
  CollectorDiagnostic,
  GatewayRuntime,
  MetricCollector,
  MetricDefinition,
  MetricSample,
} from "./types.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

import { DiagnosticsCollector } from "./diagnostics/collector.js";
import {
  renderDiagnosticsMetricsBlock,
  resetDiagnosticsMetricStore,
  startDiagnosticsSubscription,
  stopDiagnosticsSubscription,
} from "./diagnostics/subscribe.js";
import { PluginRuntimeCollector } from "./collectors/plugin-runtime.js";
import { RuntimeCollector } from "./collectors/runtime.js";
import { UsageCollector } from "./collectors/usage.js";
import { SessionCollector } from "./collectors/sessions.js";
import { ChannelCollector } from "./collectors/channels.js";
import { SkillCollector } from "./collectors/skills.js";
import { CronCollector } from "./collectors/cron.js";
import { HealthCollector } from "./collectors/health.js";
import { ModelAuthCollector } from "./collectors/model-auth.js";
import { ModelCollector } from "./collectors/models.js";
import { NodeCollector } from "./collectors/nodes.js";
import { PresenceCollector } from "./collectors/presence.js";
import { formatPrometheus } from "./formatters/prometheus.js";
import { formatJson } from "./formatters/json.js";
import { resolvePrometheusConfig } from "./config.js";
import { assertScrapeAuthorized } from "./transport/server.js";
import { CollectCache } from "./collectors/collect-cache.js";
import { PLUGIN_VERSION } from "./shared/version.js";
import {
  initializeRuntimeStore,
  getRuntimeStore,
  updateRpcSamples,
} from "./runtime/store.js";
import {
  refreshHousekeepingMetrics,
  refreshRuntimeSnapshots,
  registerPluginObservers,
  recordHttpLatency,
} from "./runtime/observer.js";
import { setRuntime } from "./runtime/ws-bridge.js";

const PLUGIN_ID = "openclaw-prometheus";

/** 内部采集状态（每个 register 调用一组） */
let collectors: MetricCollector[] = [];
let cache: CollectCache = new CollectCache(0);
const collectorErrorCounts = new Map<string, number>();

/**
 * @description 组装启用的 MetricCollector 列表。
 *
 * @param includeRuntime - 是否包含 Node 进程级 RuntimeCollector
 * @returns 采集器实例数组
 */
function buildCollectors(includeRuntime: boolean): MetricCollector[] {
  const list: MetricCollector[] = [
    new DiagnosticsCollector(),
    new PluginRuntimeCollector(),
    new UsageCollector(),
    new SessionCollector(),
    new ChannelCollector(),
    new SkillCollector(),
    new CronCollector(),
    new HealthCollector(),
    new ModelAuthCollector(),
    new ModelCollector(),
    new NodeCollector(),
    new PresenceCollector(),
  ];
  if (includeRuntime) {
    list.push(new RuntimeCollector());
  }
  return list;
}

/**
 * @description 并行执行所有 collector.collect() 并汇总定义、样本与诊断。
 *
 * @returns definitions、samples 与 per-collector diagnostics
 */
const COLLECTOR_SUCCESS_DEF: MetricDefinition = {
  name: "openclaw_metrics_collector_success",
  help: "Whether a collector succeeded during the last scrape (1=yes, 0=no)",
  type: "gauge",
  labels: ["collector"],
};

const COLLECTOR_ERRORS_TOTAL_DEF: MetricDefinition = {
  name: "openclaw_metrics_collect_errors_total",
  help: "Cumulative collector failures observed by the exporter",
  type: "counter",
  labels: ["collector"],
};

async function collectAll(): Promise<{
  definitions: MetricDefinition[];
  samples: MetricSample[];
  diagnostics: CollectorDiagnostic[];
}> {
  const allDefinitions: MetricDefinition[] = [];
  const allSamples: MetricSample[] = [];
  const diagnostics: CollectorDiagnostic[] = [];
  const rpcSamples: MetricSample[] = [];

  const results = await Promise.allSettled(collectors.map((c) => c.collect()));
  allDefinitions.push(COLLECTOR_SUCCESS_DEF, COLLECTOR_ERRORS_TOTAL_DEF);

  for (let i = 0; i < collectors.length; i++) {
    allDefinitions.push(...collectors[i].definitions);
    const result = results[i];
    const collector = collectors[i].name;
    if (result.status === "fulfilled") {
      allSamples.push(...result.value);
      if (collector !== "plugin-runtime" && collector !== "runtime" && collector !== "diagnostics") {
        rpcSamples.push(...result.value);
      }
      allSamples.push({
        name: COLLECTOR_SUCCESS_DEF.name,
        labels: { collector },
        value: 1,
      });
      allSamples.push({
        name: COLLECTOR_ERRORS_TOTAL_DEF.name,
        labels: { collector },
        value: collectorErrorCounts.get(collector) ?? 0,
      });
      diagnostics.push({ collector, ok: true });
      continue;
    }
    const nextCount = (collectorErrorCounts.get(collector) ?? 0) + 1;
    collectorErrorCounts.set(collector, nextCount);
    allSamples.push({
      name: COLLECTOR_SUCCESS_DEF.name,
      labels: { collector },
      value: 0,
    });
    allSamples.push({
      name: COLLECTOR_ERRORS_TOTAL_DEF.name,
      labels: { collector },
      value: nextCount,
    });
    diagnostics.push({
      collector,
      ok: false,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
  }

  updateRpcSamples(rpcSamples);
  return { definitions: dedupeDefinitions(allDefinitions), samples: allSamples, diagnostics };
}

const BUILD_INFO_DEF: MetricDefinition = {
  name: "openclaw_exporter_build_info",
  help: "OpenClaw Prometheus plugin build information",
  type: "gauge",
};

const SCRAPE_DURATION_DEF: MetricDefinition = {
  name: "openclaw_metrics_last_scrape_duration_seconds",
  help: "Wall time spent on last metrics collection (includes RPC), in seconds",
  type: "gauge",
};

/**
 * @description 在采集结果上追加 build info 与本次 scrape 耗时样本。
 *
 * @param definitions - 指标定义列表（会被 mutate）
 * @param samples - 指标样本列表（会被 mutate）
 * @param scrapeSeconds - 本次 scrape 墙钟耗时（秒）
 */
function appendMetaSamples(
  definitions: MetricDefinition[],
  samples: MetricSample[],
  scrapeSeconds: number,
): void {
  definitions.push(BUILD_INFO_DEF, SCRAPE_DURATION_DEF);
  samples.push({
    name: "openclaw_exporter_build_info",
    value: 1,
    labels: { plugin: PLUGIN_ID, version: PLUGIN_VERSION },
  });
  samples.push({
    name: "openclaw_metrics_last_scrape_duration_seconds",
    value: scrapeSeconds,
  });
}

/**
 * 规范化 metrics 根路径，生成子路径
 *
 * @param base - 例如 /metrics
 * @param suffix - 例如 /per-object
 */
function metricsChildPath(base: string, suffix: string): string {
  const b = base.replace(/\/$/, "") || "/metrics";
  return `${b}${suffix}`;
}

/**
 * @description 注册 HTTP 路由、diagnostics 服务与 collector 生命周期。
 *
 * @param api - OpenClaw 插件 API
 */
function registerMetricsRoutes(api: OpenClawPluginApi): void {
  const cfg = resolvePrometheusConfig(api.pluginConfig as Record<string, unknown> | undefined);
  initializeRuntimeStore(api, cfg);
  setRuntime({
    ...(api.runtime as GatewayRuntime),
    config: api.config as Record<string, unknown>,
  });
  refreshHousekeepingMetrics();
  registerPluginObservers(api);

  api.registerService({
    id: "openclaw-prometheus-diagnostics",
    start: async (ctx) => {
      await startDiagnosticsSubscription({
        logger: api.logger,
        internalDiagnostics: ctx.internalDiagnostics as import("./diagnostics/subscribe.js").InternalDiagnosticsBridge | undefined,
        config: api.config,
      });
    },
    stop: () => {
      stopDiagnosticsSubscription();
      resetDiagnosticsMetricStore();
    },
  });

  collectors = buildCollectors(cfg.includeRuntime);
  cache = new CollectCache(cfg.collectIntervalMs);
  cache.invalidate();

  const base = cfg.metricsPath;

  /**
   * 带鉴权与缓存的采集
   */
  async function runCollect(req: IncomingMessage, res: ServerResponse): Promise<{
    definitions: MetricDefinition[];
    samples: MetricSample[];
    diagnostics: CollectorDiagnostic[];
  } | null> {
    if (!assertScrapeAuthorized(req, res, cfg)) {
      return null;
    }

    const bundle = await cache.getOrCollect(async () => {
      const collectStartedAt = performance.now();
      const collected = await collectAll();
      return {
        ...collected,
        collectDurationSeconds: (performance.now() - collectStartedAt) / 1000,
      };
    });
    const scrapeSeconds = bundle.collectDurationSeconds ?? 0;

    const definitions = [...bundle.definitions];
    const samples = [...bundle.samples];
    appendMetaSamples(definitions, samples, scrapeSeconds);
    return { definitions, samples, diagnostics: bundle.diagnostics };
  }

  async function metricsHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await withRouteMetrics(base, req, res, async () => {
      const data = await runCollect(req, res);
      if (!data) {
        return;
      }
      const coreOutput = formatPrometheus(data.definitions, data.samples);
      const diagnosticsOutput = renderDiagnosticsMetricsBlock();
      const output = diagnosticsOutput
        ? `${coreOutput.trimEnd()}\n${diagnosticsOutput}`
        : coreOutput;
      res.writeHead(200, {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(output);
    });
  }

  async function perObjectHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await withRouteMetrics(metricsChildPath(base, "/per-object"), req, res, async () => {
      const data = await runCollect(req, res);
      if (!data) {
        return;
      }
      const output = formatJson(
        data.definitions,
        data.samples,
        data.diagnostics,
        buildJsonMeta(),
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(output, null, 2));
    });
  }

  async function detailedHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await withRouteMetrics(metricsChildPath(base, "/detailed"), req, res, async () => {
      if (!assertScrapeAuthorized(req, res, cfg)) {
        return;
      }

      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const familyFilter = url.searchParams.get("family");

      const t0 = performance.now();
      const bundle = await cache.getOrCollect(() => collectAll());
      const scrapeSeconds = (performance.now() - t0) / 1000;

      let filteredDefs = [...bundle.definitions];
      let filteredSamples = [...bundle.samples];

      if (familyFilter) {
        filteredDefs = filteredDefs.filter((d) => d.name.includes(familyFilter));
        filteredSamples = filteredSamples.filter((s) => s.name.includes(familyFilter));
      }

      appendMetaSamples(filteredDefs, filteredSamples, scrapeSeconds);

      const output = formatJson(
        filteredDefs,
        filteredSamples,
        bundle.diagnostics,
        buildJsonMeta(),
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(output, null, 2));
    });
  }

  async function healthHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await withRouteMetrics(metricsChildPath(base, "/health"), req, res, async () => {
      if (!assertScrapeAuthorized(req, res, cfg)) {
        return;
      }
      await refreshRuntimeSnapshots(false);
      refreshHousekeepingMetrics();
      const store = getRuntimeStore();

      // 检查 lastSnapshotRefreshAt 是否正常（< 60s ago）
      const snapshotAge = Date.now() - (store.lastSnapshotRefreshAt ?? 0);
      const snapshotHealthy = snapshotAge < 60000;
      const collectorFailures = diagnosticsFromCollectorMap();
      const healthy =
        snapshotHealthy &&
        collectorFailures.failed === 0 &&
        (store.rpcClientInitialized || !hasRpcCollectorsConfigured());

      const payload = {
        ok: true,
        healthy,
        plugin: PLUGIN_ID,
        version: PLUGIN_VERSION,
        startedAt: new Date(store.startedAt).toISOString(),
        lastSnapshotRefreshAt: store.lastSnapshotRefreshAt
          ? new Date(store.lastSnapshotRefreshAt).toISOString()
          : null,
        monitoredProviders: store.cfg.monitoredProviders,
        rpc: {
          initialized: store.rpcClientInitialized,
          lastSuccessAt: store.lastRpcSuccessAt
            ? new Date(store.lastRpcSuccessAt).toISOString()
            : null,
          lastMethod: store.lastRpcMethod ?? null,
          lastError: store.lastRpcError ?? null,
        },
        collectors: collectorFailures,
        snapshot: {
          ageMs: snapshotAge,
          healthy: snapshotHealthy,
        },
      };
      
      store.registry.set("openclaw_gateway_healthz_healthy", healthy ? 1 : 0, {
        help: "Gateway health check result (1 = healthy, 0 = unhealthy)",
        labels: { overall: "yes" },
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload, null, 2));
    });
  }

  // Debug 端点：返回详细调试信息
  async function debugHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await withRouteMetrics(metricsChildPath(base, "/debug"), req, res, async () => {
      if (!assertScrapeAuthorized(req, res, cfg)) {
        return;
      }
      const store = getRuntimeStore();
      
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const component = url.searchParams.get("component") || "all";
      
      // 返回每个 collector 的最后采集时间
      const info = {
        collectors: {
          plugin_runtime: {
            name: "PluginRuntimeCollector",
            lastRefreshAt: store.lastSnapshotRefreshAt ?? null,
          },
          channels: { name: "ChannelsCollector" },
          models: { name: "ModelsCollector" },
          sessions: { name: "SessionsCollector" },
          nodes: { name: "NodesCollector" },
          skills: { name: "SkillsCollector" },
          cron: { name: "CronCollector" },
          presence: { name: "PresenceCollector" },
          usage: { name: "UsageCollector" },
          modelAuth: { name: "ModelAuthCollector" },
        },
        registry: {
          metricsCount: store.registry.snapshotSamples().length,
          lastScrapeAt: Date.now(),
          cacheSize: store.providerSnapshots.length,
        },
        config: {
          collectIntervalMs: cfg.collectIntervalMs,
          snapshotIntervalMs: cfg.snapshotIntervalMs,
          includeRuntime: cfg.includeRuntime,
          monitoredProviders: cfg.monitoredProviders,
        },
      };

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(info, null, 2));
    });
  }

  // OpenClaw 要求显式声明 auth；未声明时路由会被静默丢弃。指标端点由插件内 scrapeAuth 可选保护，故使用 plugin。
  const routeOpts = { auth: "plugin" as const };
  api.registerHttpRoute({ ...routeOpts, path: base, handler: metricsHandler });
  api.registerHttpRoute({ ...routeOpts, path: metricsChildPath(base, "/per-object"), handler: perObjectHandler });
  api.registerHttpRoute({ ...routeOpts, path: metricsChildPath(base, "/detailed"), handler: detailedHandler });
  api.registerHttpRoute({ ...routeOpts, path: metricsChildPath(base, "/health"), handler: healthHandler });
  api.registerHttpRoute({ ...routeOpts, path: metricsChildPath(base, "/debug"), handler: debugHandler });

  if (typeof api.registerGatewayMethod === "function") {
    api.registerGatewayMethod(
      "openclaw.prometheus.status",
      async ({ respond }) => {
        const store = getRuntimeStore();
        store.registry.inc("openclaw_gateway_operator_rpc_requests_total", 1, {
          help: "Gateway operator RPC invocations handled by openclaw-prometheus",
          type: "counter",
          labels: { method: "openclaw.prometheus.status" },
        });
        respond(true, {
          ok: true,
          plugin: PLUGIN_ID,
          version: PLUGIN_VERSION,
          lastSnapshotRefreshAt: store.lastSnapshotRefreshAt ?? null,
          monitoredProviders: store.providerSnapshots,
        });
      },
      { scope: "operator.read" },
    );

  // Alertmanager 集成：配置告警规则
  api.registerGatewayMethod(
    "openclaw.alertmanager.configure",
    async ({ respond }) => {
      const { registry } = getRuntimeStore();

      const alertRules = [
        {
          name: "agent_run_p95",
          expr: "agent_run_p95 > 300",
          for: "5m",
          severity: "warning",
        },
        {
          name: "agent_run_p99",
          expr: "agent_run_p99 > 600",
          for: "10m",
          severity: "critical",
        },
        {
          name: "channel_health",
          expr: "channel_health < 0.95",
          for: "5m",
          severity: "warning",
        },
      ];

      registry.inc("openclaw_alertmanager_rules_total", alertRules.length, {
        help: "Alertmanager alert rules configured",
      });

      respond(true, {
        configured: alertRules.length,
        active: alertRules.length,
        rules: alertRules,
      });
    },
    { scope: "operator.read" },
  );
  }

  const names = collectors.map((c) => c.name).join(", ");
  console.log(`[openclaw-prometheus] Plugin registered — ${collectors.length} collectors: ${names}`);
  console.log(
    `[openclaw-prometheus] metrics path: ${base} (cache ${cfg.collectIntervalMs}ms, snapshot ${cfg.snapshotIntervalMs}ms, runtime ${cfg.includeRuntime ? "on" : "off"}, scrapeAuth ${cfg.scrapeAuthEnabled ? "on" : "off"})`,
  );
  console.log(`  GET ${base}             — Prometheus text`);
  console.log(`  GET ${metricsChildPath(base, "/per-object")}  — JSON`);
  console.log(`  GET ${metricsChildPath(base, "/detailed")}    — JSON (?family=)`);
  console.log(`  GET ${metricsChildPath(base, "/health")}      — plugin health`);
}

/** @description 从 collector 错误计数汇总 failed/total 诊断。 */
function diagnosticsFromCollectorMap(): { total: number; failed: number } {
  const total = collectors.length;
  let failed = 0;
  for (const collector of collectors) {
    const count = collectorErrorCounts.get(collector.name) ?? 0;
    const success =
      collector.name === "plugin-runtime" || collector.name === "diagnostics"
        ? true
        : count === 0;
    if (!success) {
      failed += 1;
    }
  }
  return { total, failed };
}

/** @description 是否存在依赖 RPC 的 collector（非 plugin-runtime/runtime/diagnostics）。 */
function hasRpcCollectorsConfigured(): boolean {
  return collectors.some(
    (collector) =>
      collector.name !== "plugin-runtime" &&
      collector.name !== "runtime" &&
      collector.name !== "diagnostics",
  );
}

/** @description 按 metric name 去重 MetricDefinition 列表。 */
function dedupeDefinitions(definitions: MetricDefinition[]): MetricDefinition[] {
  const seen = new Set<string>();
  const deduped: MetricDefinition[] = [];
  for (const definition of definitions) {
    if (seen.has(definition.name)) {
      continue;
    }
    seen.add(definition.name);
    deduped.push(definition);
  }
  return deduped;
}

/** @description 构建 JSON 格式 scrape 响应中的 rpc/collectors 元数据块。 */
function buildJsonMeta(): {
  rpc: {
    initialized: boolean;
    lastSuccessAt: string | null;
    lastMethod: string | null;
    lastError: string | null;
  };
  collectors: {
    total: number;
    failed: number;
  };
} {
  const store = getRuntimeStore();
  return {
    rpc: {
      initialized: store.rpcClientInitialized,
      lastSuccessAt: store.lastRpcSuccessAt ? new Date(store.lastRpcSuccessAt).toISOString() : null,
      lastMethod: store.lastRpcMethod ?? null,
      lastError: store.lastRpcError ?? null,
    },
    collectors: diagnosticsFromCollectorMap(),
  };
}

/**
 * @description 包装 HTTP handler：记录请求计数与 duration histogram。
 *
 * @param routePath - 注册的路由路径
 * @param req - 入站 HTTP 请求
 * @param res - 出站 HTTP 响应
 * @param fn - 实际 handler 逻辑
 */
async function withRouteMetrics(
  routePath: string,
  req: IncomingMessage,
  res: ServerResponse,
  fn: () => Promise<void>,
): Promise<void> {
  const startedAt = performance.now();
  try {
    await fn();
  } finally {
    const statusCode =
      typeof (res as ServerResponse & { statusCode?: number }).statusCode === "number"
        ? String((res as ServerResponse & { statusCode?: number }).statusCode)
        : "200";
    const { registry } = getRuntimeStore();
    const labels = {
      route: routePath,
      method: req.method ?? "GET",
      status: statusCode,
    };
    registry.inc("openclaw_metrics_http_requests_total", 1, {
      help: "HTTP requests served by the Prometheus plugin routes",
      type: "counter",
      labels,
    });
    const durationSeconds = (performance.now() - startedAt) / 1000;
    registry.observeHistogram("openclaw_metrics_http_request_duration_seconds", durationSeconds, {
      help: "HTTP request duration served by the Prometheus plugin routes",
      labels: {
        route: routePath,
        method: req.method ?? "GET",
      },
    });
    recordHttpLatency(durationSeconds);
  }
}

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "openclaw-prometheus",
  description:
    "Prometheus metrics exporter for OpenClaw Gateway — supersedes bundled diagnostics-prometheus (internal diagnostic events) plus RPC/hook/SLI extensions",
  register(api: OpenClawPluginApi) {
    registerMetricsRoutes(api);
  },
});
