import { E2E_PORTS } from "../../lib/utils.mjs";

/**
 * OpenMem 独占 memory slot，并显式授权 `agent_end` 读取本轮对话。
 * Sidecar 使用工作区真实 OpenMem Server，由 E2E 编排器在 Gateway 之前启动。
 */
export function openmemConfig() {
  const protectedMode = process.env.OPENMEM_E2E_PROTECTED === "1";
  const protectedUrl = process.env.OPENMEM_E2E_PROXY_URL;
  if (protectedMode && !/^https:\/\/127\.0\.0\.1:\d+$/.test(protectedUrl ?? "")) {
    throw new Error("protected OpenMem E2E requires a loopback HTTPS proxy URL");
  }
  return {
    pluginEntry: {
      openmem: {
        enabled: true,
        hooks: { allowConversationAccess: true },
        config: {
          enabled: true,
          required: true,
          baseUrl: protectedMode ? protectedUrl : `http://127.0.0.1:${E2E_PORTS.openmem}`,
          ...(protectedMode ? { apiKeyEnv: "OPENMEM_E2E_PROXY_TOKEN" } : {}),
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
