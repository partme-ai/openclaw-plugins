import { E2E_PORTS } from "../../lib/utils.mjs";

/** 美团 capability 的隔离只读 operation；写操作确认由单元契约测试覆盖。 */
export function meituanConfig() {
  return {
    pluginEntry: {
      meituan: {
        enabled: true,
        config: {
          enabled: true,
          developerId: "123456",
          signKey: "meituan-e2e-sign-key",
          appAuthToken: "meituan-e2e-auth-token",
          apiBaseUrl: `http://127.0.0.1:${E2E_PORTS.meituanProvider}`,
          operations: [{
            name: "shop_query",
            description: "E2E 只读门店查询",
            apiPath: "/e2e/shop/query",
            businessId: 7001,
            requiresAuth: true,
            riskLevel: "read",
            successCodes: ["OP_SUCCESS"],
          }],
          requestTimeoutMs: 5_000,
          maxRequestBytes: 65_536,
          maxResponseBytes: 65_536,
          maxToolResultBytes: 32_768,
          maxRequestsPerMinute: 10,
          maxConcurrentRequests: 2,
          readRetryMaxAttempts: 2,
          ownerOnly: false,
        },
      },
    },
    channelEntry: {},
  };
}
