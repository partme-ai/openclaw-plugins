/**
 * @fileoverview Tracing 插件配置的兼容合并、数值边界和 OTLP 地址规范化。
 *
 * 插件配置覆盖旧版全局配置，统一校验采样率、Span/缓冲上限、刷出周期、保留天数及重试参数；
 * OTLP 地址只接受 HTTP(S)，并规范为无 query/hash 的 `/v1/traces` 端点。
 */
import type { TracingConfig } from "./shared/types.js";

const DEFAULT_CONFIG: TracingConfig = {
  enabled: false,
  backend: "log",
  otlpEndpoint: "http://localhost:4318/v1/traces",
  otlpHeaders: {},
  sampleRate: 1,
  traceDir: "./traces",
  traceRetentionDays: 7,
  maxSpansPerTrace: 100,
  maxActiveTraces: 10_000,
  maxBufferedSpans: 10_000,
  flushIntervalMs: 5_000,
  exportTimeoutMs: 10_000,
  exportRetryAttempts: 3,
  shutdownTimeoutMs: 15_000,
  captureMessageBody: false,
};

const CONFIG_KEYS = new Set<keyof TracingConfig>(Object.keys(DEFAULT_CONFIG) as Array<keyof TracingConfig>);
const HTTP_HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

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

/** 校验 OTLP 鉴权头，同时阻断 CRLF 注入及 fetch 管理的危险传输头。 */
function assertHeaders(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("otlpHeaders must be an object of string values");
  }
  const result: Record<string, string> = {};
  for (const [name, rawValue] of Object.entries(value)) {
    const lowerName = name.toLowerCase();
    if (
      !HTTP_HEADER_NAME.test(name) ||
      lowerName === "host" ||
      lowerName === "content-length" ||
      lowerName === "content-type"
    ) {
      throw new Error(`otlpHeaders contains unsupported header name: ${name}`);
    }
    if (typeof rawValue !== "string" || rawValue.length === 0 || /[\r\n]/.test(rawValue)) {
      throw new Error(`otlpHeaders.${name} must be a non-empty single-line string`);
    }
    result[name] = rawValue;
  }
  return result;
}

/** 合并旧版全局配置和插件配置，并执行运行时校验。 */
export function normalizeTracingConfig(
  legacy: Record<string, unknown> | undefined,
  plugin: Record<string, unknown> | undefined,
): TracingConfig {
  const raw = { ...legacy, ...plugin };
  const config = { ...DEFAULT_CONFIG, otlpHeaders: { ...DEFAULT_CONFIG.otlpHeaders } };

  const unknownKeys = Object.keys(raw).filter((key) => !CONFIG_KEYS.has(key as keyof TracingConfig));
  if (unknownKeys.length > 0) {
    throw new Error(`unknown tracing config field: ${unknownKeys.join(", ")}`);
  }

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
  if (raw.otlpHeaders !== undefined) config.otlpHeaders = assertHeaders(raw.otlpHeaders);
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
  if (raw.maxActiveTraces !== undefined) {
    config.maxActiveTraces = assertNumber(raw.maxActiveTraces, "maxActiveTraces", {
      min: 1,
      max: 1_000_000,
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
  if (raw.shutdownTimeoutMs !== undefined) {
    config.shutdownTimeoutMs = assertNumber(raw.shutdownTimeoutMs, "shutdownTimeoutMs", {
      min: 100,
      max: 300_000,
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
  if (url.username || url.password) {
    throw new Error("otlpEndpoint must not contain credentials; use otlpHeaders for authentication");
  }
  url.hash = "";
  url.search = "";
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/v1/traces") ? path : `${path}/v1/traces`;
  return url.toString().replace(/\/$/, "");
}

export { DEFAULT_CONFIG };
