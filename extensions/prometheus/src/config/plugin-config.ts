/**
 * 解析插件侧配置（来自 `plugins.entries.prometheus.config` / `api.pluginConfig`）。
 */

/** 与 openclaw.plugin.json 中 configSchema 对齐的运行时配置形状 */
export type PrometheusPluginUserConfig = {
  path?: string;
  collectIntervalMs?: number;
  snapshotIntervalMs?: number;
  workloadWindowMs?: number;
  includeRuntime?: boolean;
  monitoredProviders?: string[];
  instance?: string;
  collectorTimeoutMs?: number;
  maxScrapeSeries?: number;
  scrapeAuth?: {
    /** 为 true 时要求请求携带 Bearer Token（优先环境变量，见 README） */
    enabled?: boolean;
    /** 仅建议用于本地测试；生产请使用 OPENCLAW_PROMETHEUS_BEARER_TOKEN */
    bearerToken?: string;
  };
};

export type ResolvedPrometheusConfig = {
  metricsPath: string;
  collectIntervalMs: number;
  snapshotIntervalMs: number;
  workloadWindowMs: number;
  includeRuntime: boolean;
  monitoredProviders: string[];
  scrapeAuthEnabled: boolean;
  /** 解析后的 token：配置项或环境变量 */
  scrapeBearerToken: string | undefined;
  /** Instance label for multi-deployment */
  instance: string;
  collectorTimeoutMs: number;
  maxScrapeSeries: number;
};

const ENV_BEARER = "OPENCLAW_PROMETHEUS_BEARER_TOKEN";
const LEGACY_ENV_BEARER = "openclaw-prometheus_BEARER_TOKEN";
const HTTP_PATH_PATTERN = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/;

/**
 * 将用户配置合并为带默认值的解析结果。
 *
 * @param raw - Gateway 注入的 pluginConfig
 * @param env - 默认为 process.env，测试可注入
 */
export function resolvePrometheusConfig(
  raw: Record<string, unknown> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedPrometheusConfig {
  const c = (raw ?? {}) as PrometheusPluginUserConfig;
  const metricsPath = readPath(c.path);
  const collectIntervalMs = readInteger(c.collectIntervalMs, "collectIntervalMs", 0, 3_600_000, 15_000);
  const snapshotIntervalMs = readInteger(c.snapshotIntervalMs, "snapshotIntervalMs", 1_000, 3_600_000, 30_000);
  const workloadWindowMs = readInteger(c.workloadWindowMs, "workloadWindowMs", 60_000, 86_400_000, 300_000);
  const includeRuntime = c.includeRuntime !== false;
  const monitoredProviders = readProviders(c.monitoredProviders);
  const scrapeAuthEnabled = c.scrapeAuth?.enabled === true;
  const fromEnv = env[ENV_BEARER]?.trim() || env[LEGACY_ENV_BEARER]?.trim();
  const fromConfig =
    typeof c.scrapeAuth?.bearerToken === "string" ? c.scrapeAuth.bearerToken.trim() : "";
  const scrapeBearerToken = fromEnv || fromConfig || undefined;

  return {
    metricsPath,
    collectIntervalMs,
    snapshotIntervalMs,
    workloadWindowMs,
    includeRuntime,
    monitoredProviders,
    scrapeAuthEnabled,
    scrapeBearerToken,
    instance: readInstance(c.instance),
    collectorTimeoutMs: readInteger(c.collectorTimeoutMs, "collectorTimeoutMs", 100, 60_000, 10_000),
    maxScrapeSeries: readInteger(c.maxScrapeSeries, "maxScrapeSeries", 100, 50_000, 10_000),
  };
}

function readPath(value: unknown): string {
  if (value === undefined) return "/metrics";
  if (typeof value !== "string" || !HTTP_PATH_PATTERN.test(value) || value.includes("//") || value.length > 256) {
    throw new Error("prometheus.path must be a valid absolute HTTP path (max 256 characters)");
  }
  const normalized = value.length > 1 ? value.replace(/\/$/, "") : value;
  if (normalized === "/") {
    throw new Error("prometheus.path must not claim the Gateway root path");
  }
  return normalized;
}

function readInteger(value: unknown, name: string, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`prometheus.${name} must be an integer between ${min} and ${max}`);
  }
  return value as number;
}

function readProviders(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64) {
    throw new Error("prometheus.monitoredProviders must be an array with at most 64 entries");
  }
  const providers = value.map((entry) => {
    if (typeof entry !== "string" || entry.trim().length === 0 || entry.trim().length > 128) {
      throw new Error("prometheus.monitoredProviders entries must be non-empty strings up to 128 characters");
    }
    return entry.trim();
  });
  return [...new Set(providers)];
}

function readInstance(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.trim().length > 128) {
    throw new Error("prometheus.instance must be a string up to 128 characters");
  }
  return value.trim();
}

/**
 * 返回环境变量名说明（供日志 / 文档引用）
 */
export function scrapeTokenEnvName(): string {
  return ENV_BEARER;
}
