/**
 * Diagnostics 指标存储单例与订阅生命周期。
 */

import type { DiagnosticEventMetadata, DiagnosticEventPayload } from "openclaw/plugin-sdk/diagnostic-runtime";
import type { RuntimeLogger } from "../types.js";
import {
  createPrometheusMetricStore,
  recordDiagnosticEvent,
  renderPrometheusMetrics,
  safeDiagnosticHandlerError,
  type PrometheusMetricStore,
} from "./metric-store.js";

let store: PrometheusMetricStore | null = null;
let unsubscribe: (() => void) | undefined;

const BUNDLED_DIAGNOSTICS_PLUGIN_ID = "diagnostics-prometheus";

/**
 * 检测 Gateway 配置中 bundled `diagnostics-prometheus` 是否仍处于启用状态。
 */
export function isBundledDiagnosticsPrometheusEnabled(config: unknown): boolean {
  if (!config || typeof config !== "object") {
    return false;
  }
  const plugins = (config as Record<string, unknown>).plugins;
  if (!plugins || typeof plugins !== "object") {
    return false;
  }
  const entries = (plugins as Record<string, unknown>).entries;
  if (!entries || typeof entries !== "object") {
    return false;
  }
  const entry = (entries as Record<string, unknown>)[BUNDLED_DIAGNOSTICS_PLUGIN_ID];
  if (entry === undefined || entry === null) {
    return false;
  }
  if (typeof entry === "boolean") {
    return entry;
  }
  if (typeof entry === "object") {
    const enabled = (entry as Record<string, unknown>).enabled;
    if (enabled === false) {
      return false;
    }
    return true;
  }
  return false;
}

/**
 * 订阅成功后若 bundled exporter 仍启用，记录可操作的重复指标告警。
 */
function warnIfDuplicateDiagnosticsExporter(logger: RuntimeLogger, config: unknown): void {
  if (!isBundledDiagnosticsPrometheusEnabled(config)) {
    return;
  }
  logger.warn(
    "openclaw-prometheus: bundled diagnostics-prometheus is also enabled in plugins.entries — " +
      "duplicate internal diagnostic subscriptions will inflate metrics (e.g. openclaw_model_tokens_total). " +
      'Set plugins.entries["diagnostics-prometheus"].enabled to false and restart the Gateway.',
  );
}

export type InternalDiagnosticsBridge = {
  emit: (event: Record<string, unknown>) => void;
  onEvent: (
    listener: (event: DiagnosticEventPayload, metadata: DiagnosticEventMetadata) => void,
  ) => () => void;
};

/**
 * 获取（或懒创建）diagnostics Prometheus 指标存储。
 */
export function getDiagnosticsMetricStore(): PrometheusMetricStore {
  if (!store) {
    store = createPrometheusMetricStore();
  }
  return store;
}

/**
 * 重置存储并取消订阅（gateway 停止 / 插件 reload 时调用）。
 */
export function resetDiagnosticsMetricStore(): void {
  unsubscribe?.();
  unsubscribe = undefined;
  store?.reset();
  store = null;
}

/**
 * 渲染 diagnostics 指标块（Prometheus text），供 `/metrics` 追加输出。
 */
export function renderDiagnosticsMetricsBlock(): string {
  if (!store) {
    return "";
  }
  return renderPrometheusMetrics(store);
}

/**
 * 订阅 OpenClaw internal diagnostics 事件流。
 *
 * 优先使用 service context 的 `internalDiagnostics`（bundled 官方路径）；
 * 否则尝试 `openclaw/plugin-sdk/diagnostic-runtime` 的 `onInternalDiagnosticEvent`。
 */
export async function startDiagnosticsSubscription(params: {
  logger: RuntimeLogger;
  internalDiagnostics?: InternalDiagnosticsBridge;
  config?: unknown;
}): Promise<void> {
  unsubscribe?.();
  const metricStore = getDiagnosticsMetricStore();

  const listener = (event: DiagnosticEventPayload, metadata: DiagnosticEventMetadata) => {
    try {
      recordDiagnosticEvent(metricStore, event, metadata);
    } catch (err) {
      params.logger.error(
        `openclaw-prometheus: diagnostic event handler failed (${event.type}): ${safeDiagnosticHandlerError(err)}`,
      );
    }
  };

  if (params.internalDiagnostics?.onEvent) {
    unsubscribe = params.internalDiagnostics.onEvent(listener);
    params.internalDiagnostics.emit({
      type: "telemetry.exporter",
      exporter: "openclaw-prometheus",
      signal: "metrics",
      status: "started",
      reason: "configured",
    });
    params.logger.info("openclaw-prometheus: subscribed via internalDiagnostics.onEvent");
    warnIfDuplicateDiagnosticsExporter(params.logger, params.config);
    return;
  }

  try {
    const mod = await import("openclaw/plugin-sdk/diagnostic-runtime");
    if (typeof mod.onInternalDiagnosticEvent === "function") {
      unsubscribe = mod.onInternalDiagnosticEvent(listener);
      if (typeof mod.emitTrustedDiagnosticEvent === "function") {
        mod.emitTrustedDiagnosticEvent({
          type: "telemetry.exporter",
          exporter: "openclaw-prometheus",
          signal: "metrics",
          status: "started",
          reason: "sdk-fallback",
        });
      }
      params.logger.info("openclaw-prometheus: subscribed via onInternalDiagnosticEvent (SDK fallback)");
      warnIfDuplicateDiagnosticsExporter(params.logger, params.config);
      return;
    }
  } catch {
    // optional peer — diagnostics block stays empty until Gateway provides SDK
  }

  params.logger.warn(
    "openclaw-prometheus: internal diagnostics unavailable — token/run/tool histogram metrics require Gateway diagnostic events",
  );
}

/**
 * 停止 diagnostics 订阅（保留已采集样本，直到 reset）。
 */
export function stopDiagnosticsSubscription(): void {
  unsubscribe?.();
  unsubscribe = undefined;
}
