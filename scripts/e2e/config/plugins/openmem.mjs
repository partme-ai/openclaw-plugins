import { E2E_PORTS } from "../../lib/utils.mjs";

/**
 * OpenMem 独占 memory slot，并显式授权 `agent_end` 读取本轮对话。
 * Sidecar 使用工作区真实 OpenMem Server，由 E2E 编排器在 Gateway 之前启动。
 */
export function openmemConfig() {
  return {
    pluginEntry: {
      openmem: {
        enabled: true,
        hooks: { allowConversationAccess: true },
        config: {
          enabled: true,
          required: true,
          baseUrl: `http://127.0.0.1:${E2E_PORTS.openmem}`,
          agentId: "main",
          maxSearchResults: 10,
          timeoutMs: 5_000,
          maxAttempts: 3,
          retryBaseDelayMs: 50,
          maxResponseBytes: 2_097_152,
          maxCacheBytes: 8_388_608,
          allowSharedRecall: false,
        },
      },
    },
    channelEntry: {},
    pluginSlots: { memory: "openmem" },
  };
}
