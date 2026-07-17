/**
 * @module nacos/setup-entry
 *
 * Lightweight setup entry for openclaw-nacos.
 *
 * Loaded when the plugin is disabled or unconfigured, avoiding heavy Nacos client imports.
 * See https://docs.openclaw.ai/plugins/sdk-entrypoints (`defineSetupPluginEntry`).
 *
 * 中文说明：这是 OpenClaw 配置阶段使用的轻量入口，只做最小 Schema 与 serverList
 * 校验；不要在这里导入 Nacos SDK，否则插件未启用时也会加载网络客户端及其副作用。
 */
import type { NacosPluginConfig } from "./shared/types.js";

const pluginObject = {
  id: "nacos" as const,
  configSchema: {
    type: "object" as const,
    properties: {
      serverList: { type: "string" as const },
    },
  },
  parseConfig(raw: unknown): { kind: "ok" | "error"; config?: NacosPluginConfig; message?: string } {
    if (!raw || typeof raw !== "object") {
      return { kind: "error", message: "config must be an object" };
    }
    const r = raw as Record<string, unknown>;
    if (typeof r.serverList !== "string" || !r.serverList) {
      return { kind: "error", message: "serverList is required" };
    }
    return { kind: "ok", config: { serverList: r.serverList } as NacosPluginConfig };
  },
};

const setupEntry = { plugin: pluginObject };
export default setupEntry;
