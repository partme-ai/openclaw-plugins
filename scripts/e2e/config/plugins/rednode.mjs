import { E2E_PORTS } from "../../lib/utils.mjs";

/** RedNode capability 的隔离只读 operation；写操作确认由单元契约测试覆盖。 */
export function rednodeConfig() {
  return {
    pluginEntry: {
      rednode: {
        enabled: true,
        config: {
          enabled: true,
          appKey: "rednode-e2e-app-key",
          appSecret: "rednode-e2e-app-secret",
          environment: "production",
          apiBaseUrl: `http://127.0.0.1:${E2E_PORTS.rednodeProvider}`,
          operations: [{
            name: "item_list",
            description: "E2E 只读商品列表",
            method: "GET",
            apiPath: "/ark/open_api/v1/items",
          }],
          requestTimeoutMs: 5_000,
          maxRequestBytes: 65_536,
          maxResponseBytes: 65_536,
          maxToolResultBytes: 32_768,
          maxRequestsPerMinute: 10,
          getRetryMaxAttempts: 2,
          retryInitialDelayMs: 50,
          retryMaxDelayMs: 50,
          retryJitterRatio: 0,
          ownerOnly: false,
        },
      },
    },
    channelEntry: {},
  };
}
