import { E2E_PORTS } from "../../lib/utils.mjs";

/** AMap 是 capability 插件，配置只进入 plugins.entries.amap.config。 */
export function amapConfig() {
  return {
    pluginEntry: {
      amap: {
        enabled: true,
        config: {
          enabled: true,
          key: "amap-e2e-web-service-key",
          privateKey: "amap-e2e-private-key",
          apiBaseUrl: `http://127.0.0.1:${E2E_PORTS.amapProvider}`,
          requestTimeoutMs: 5_000,
          retryAttempts: 1,
          maxResponseBytes: 65_536,
          maxToolResultBytes: 32_768,
          maxRequestsPerMinute: 10,
          maxConcurrentRequests: 2,
          ownerOnly: false,
        },
      },
    },
    channelEntry: {},
  };
}
