import type { TracingConfig } from "./shared/types.js";

const DEFAULT_CONFIG: TracingConfig = {
  enabled: false,
  backend: "log",
  otlpEndpoint: "http://localhost:4318/v1/traces",
  sampleRate: 1,
  traceDir: "./traces",
  traceRetentionDays: 7,
  maxSpansPerTrace: 100,
  maxBufferedSpans: 10_000,
  flushIntervalMs: 5_000,
  exportTimeoutMs: 10_000,
  exportRetryAttempts: 3,
  captureMessageBody: false,
};

function assertBoolean(value: unknown, key: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${key} must be a boolean`);
  }
  return value;
}

function assertString(value: unknown, key: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value.trim();
}

function assertNumber(
  value: unknown,
  key: string,
  options: { min: number; max?: number; integer?: boolean },
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < options.min ||
    (options.max !== undefined && value > options.max) ||
    (options.integer === true && !Number.isInteger(value))
  ) {
    const range = options.max === undefined ? `>= ${options.min}` : `${options.min}..${options.max}`;
    throw new Error(`${key} must be ${options.integer ? "an integer " : ""}in range ${range}`);
  }
  return value;
}

/** 合并旧版全局配置和插件配置，并执行运行时校验。 */
export function normalizeTracingConfig(
  legacy: Record<string, unknown> | undefined,
  plugin: Record<string, unknown> | undefined,
): TracingConfig {
  const raw = { ...legacy, ...plugin };
  const config = { ...DEFAULT_CONFIG };

  if (raw.enabled !== undefined) config.enabled = assertBoolean(raw.enabled, "enabled");
  if (raw.captureMessageBody !== undefined) {
    config.captureMessageBody = assertBoolean(raw.captureMessageBody, "captureMessageBody");
  }
  if (raw.backend !== undefined) {
    const backend = assertString(raw.backend, "backend");
    if (backend !== "log" && backend !== "file" && backend !== "otlp") {
      throw new Error("backend must be one of: log, file, otlp");
    }
    config.backend = backend;
  }
  if (raw.otlpEndpoint !== undefined) {
    config.otlpEndpoint = normalizeOtlpEndpoint(assertString(raw.otlpEndpoint, "otlpEndpoint"));
  }
  if (raw.traceDir !== undefined) config.traceDir = assertString(raw.traceDir, "traceDir");
  if (raw.traceRetentionDays !== undefined) {
    config.traceRetentionDays = assertNumber(raw.traceRetentionDays, "traceRetentionDays", {
      min: 1,
      max: 3650,
      integer: true,
    });
  }
  if (raw.sampleRate !== undefined) {
    config.sampleRate = assertNumber(raw.sampleRate, "sampleRate", { min: 0, max: 1 });
  }
  if (raw.maxSpansPerTrace !== undefined) {
    config.maxSpansPerTrace = assertNumber(raw.maxSpansPerTrace, "maxSpansPerTrace", {
      min: 1,
      max: 100_000,
      integer: true,
    });
  }
  if (raw.maxBufferedSpans !== undefined) {
    config.maxBufferedSpans = assertNumber(raw.maxBufferedSpans, "maxBufferedSpans", {
      min: 1,
      max: 1_000_000,
      integer: true,
    });
  }
  if (raw.flushIntervalMs !== undefined) {
    config.flushIntervalMs = assertNumber(raw.flushIntervalMs, "flushIntervalMs", {
      min: 100,
      max: 3_600_000,
      integer: true,
    });
  }
  if (raw.exportTimeoutMs !== undefined) {
    config.exportTimeoutMs = assertNumber(raw.exportTimeoutMs, "exportTimeoutMs", {
      min: 100,
      max: 300_000,
      integer: true,
    });
  }
  if (raw.exportRetryAttempts !== undefined) {
    config.exportRetryAttempts = assertNumber(raw.exportRetryAttempts, "exportRetryAttempts", {
      min: 1,
      max: 10,
      integer: true,
    });
  }

  config.otlpEndpoint = normalizeOtlpEndpoint(config.otlpEndpoint);
  return config;
}

/** 接受 collector 基址或完整 OTLP trace URL，统一成 `/v1/traces`。 */
export function normalizeOtlpEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("otlpEndpoint must be a valid http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("otlpEndpoint must use http or https");
  }
  url.hash = "";
  url.search = "";
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/v1/traces") ? path : `${path}/v1/traces`;
  return url.toString().replace(/\/$/, "");
}

export { DEFAULT_CONFIG };
