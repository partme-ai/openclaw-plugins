/**
 * @module nacos/setup-entry
 *
 * Lightweight setup entry for openclaw-nacos.
 *
 * Loaded when the plugin is disabled or unconfigured, avoiding heavy Nacos client imports.
 * See https://docs.openclaw.ai/plugins/sdk-entrypoints (`defineSetupPluginEntry`).
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
