/**
 * 解析插件侧配置（来自 `plugins.entries.openclaw-prometheus.config` / `api.pluginConfig`）。
 */

/** 与 openclaw.plugin.json 中 configSchema 对齐的运行时配置形状 */
export type PrometheusPluginUserConfig = {
  port?: number;
  path?: string;
  collectIntervalMs?: number;
  snapshotIntervalMs?: number;
  workloadWindowMs?: number;
  includeRuntime?: boolean;
  monitoredProviders?: string[];
  instance?: string;
  scrapeAuth?: {
    /** 为 true 时要求请求携带 Bearer Token（优先环境变量，见 README） */
    enabled?: boolean;
    /** 仅建议用于本地测试；生产请使用 openclaw-prometheus_BEARER_TOKEN */
    bearerToken?: string;
  };
};

export type ResolvedPrometheusConfig = {
  port: number;
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
};

const ENV_BEARER = "openclaw-prometheus_BEARER_TOKEN";

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
  const metricsPath =
    typeof c.path === "string" && c.path.startsWith("/") ? c.path : "/metrics";
  const collectIntervalMs =
    typeof c.collectIntervalMs === "number" && c.collectIntervalMs >= 0
      ? c.collectIntervalMs
      : 15000;
  const snapshotIntervalMs =
    typeof c.snapshotIntervalMs === "number" && c.snapshotIntervalMs >= 1000
      ? c.snapshotIntervalMs
      : 30000;
  const workloadWindowMs =
    typeof c.workloadWindowMs === "number" && c.workloadWindowMs >= 60000
      ? c.workloadWindowMs
      : 300000;
  const includeRuntime = c.includeRuntime !== false;
  const monitoredProviders = Array.isArray(c.monitoredProviders)
    ? c.monitoredProviders
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value): value is string => value.length > 0)
    : [];
  const scrapeAuthEnabled = c.scrapeAuth?.enabled === true;
  const fromEnv = env[ENV_BEARER]?.trim();
  const fromConfig =
    typeof c.scrapeAuth?.bearerToken === "string" ? c.scrapeAuth.bearerToken.trim() : "";
  const scrapeBearerToken = fromEnv || fromConfig || undefined;

  return {
    port: typeof c.port === "number" ? c.port : 9090,
    metricsPath,
    collectIntervalMs,
    snapshotIntervalMs,
    workloadWindowMs,
    includeRuntime,
    monitoredProviders,
    scrapeAuthEnabled,
    scrapeBearerToken,
    instance: c.instance ?? "",
  };
}

/**
 * 返回环境变量名说明（供日志 / 文档引用）
 */
export function scrapeTokenEnvName(): string {
  return ENV_BEARER;
}
