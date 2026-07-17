/** Prometheus E2E 使用的固定测试 Token；只写入一次性隔离 profile。 */
export const PROMETHEUS_E2E_TOKEN = "openclaw-prometheus-e2e-token";

/**
 * 生成 Prometheus 的隔离运行配置。
 *
 * 关闭采集缓存可以让并发抓取真正经过 single-flight 边界；开启 Bearer 鉴权用于同时
 * 验证 401、正确 Token、健康路由以及指标正文不会泄露测试密钥。
 */
export function prometheusConfig() {
  return {
    pluginEntry: {
      prometheus: {
        enabled: true,
        config: {
          path: "/metrics",
          collectIntervalMs: 0,
          snapshotIntervalMs: 1_000,
          workloadWindowMs: 60_000,
          collectorTimeoutMs: 5_000,
          maxScrapeSeries: 10_000,
          includeRuntime: true,
          monitoredProviders: [],
          instance: "e2e",
          scrapeAuth: {
            enabled: true,
            bearerToken: PROMETHEUS_E2E_TOKEN,
          },
        },
      },
    },
    channelEntry: {},
  };
}
