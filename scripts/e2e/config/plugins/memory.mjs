import { join } from "node:path";
import { STATE_DIR } from "../../lib/utils.mjs";

/** Memory E2E 的持久目录；Gateway 重启时保留，冷启动 E2E 重置整个 profile。 */
export const MEMORY_E2E_DATA_DIR = join(STATE_DIR, "memory-e2e-data");

/**
 * 选择当前插件拥有 OpenClaw 独占 memory slot。
 *
 * `profileScope=agent` 只用于隔离的单用户测试 profile，使两个不同 session 可以验证
 * L3 画像召回；默认生产配置仍是更严格的 session scope。
 */
export function memoryConfig() {
  return {
    pluginEntry: {
      memory: {
        enabled: true,
        hooks: {
          allowConversationAccess: true,
        },
        config: {
          enabled: true,
          dataDir: MEMORY_E2E_DATA_DIR,
          maxSearchResults: 10,
          retentionDays: 30,
          extractionInterval: 1,
          maxRecordBytes: 65_536,
          profileScope: "agent",
        },
      },
    },
    channelEntry: {},
    pluginSlots: { memory: "memory" },
  };
}
