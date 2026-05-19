/**
 * Lightweight setup entry for openclaw-nacos.
 *
 * Loaded when the plugin is disabled or unconfigured, avoiding heavy Nacos client imports.
 * See https://docs.openclaw.ai/plugins/sdk-entrypoints (`defineSetupPluginEntry`).
 */
import { defineSetupPluginEntry } from "openclaw/plugin-sdk/setup-runtime";
import type { NacosPluginConfig } from "./types.js";

const pluginObject = {
  id: "openclaw-nacos" as const,
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

const setupEntry = defineSetupPluginEntry(pluginObject as unknown as Record<string, unknown>);
export default setupEntry;
