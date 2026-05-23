/**
 * ICS 可选运营 REST 路由注册（lazy import，仅 icsEnabled 时加载）。
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { GatewayRuntime } from "../types.js";

/**
 * 注册 `/ics/*` HTTP 路由；handler 内 lazy import，避免核心路径依赖 ICS 模块。
 */
export function registerIcsHttpRoutes(api: OpenClawPluginApi): void {
  const runtime = api.runtime as unknown as GatewayRuntime;

  api.registerHttpRoute({
    path: "/ics/agents",
    auth: "plugin",
    handler: async (req, res) => {
      const { createAgentKnowledgeAdminHandler } = await import("./handlers/agent-knowledge-admin.js");
      return createAgentKnowledgeAdminHandler(runtime)(req, res);
    },
  });

  api.registerHttpRoute({
    path: "/ics/config/bindings",
    auth: "plugin",
    handler: async (req, res) => {
      const { createBindingsHandler } = await import("./handlers/bindings.js");
      return createBindingsHandler(runtime)(req, res);
    },
  });

  api.registerHttpRoute({
    path: "/ics/config/event-messages",
    auth: "plugin",
    handler: async (req, res) => {
      const { createEventMessagesHandler } = await import("./handlers/event-messages.js");
      return createEventMessagesHandler(runtime)(req, res);
    },
  });

  api.registerHttpRoute({
    path: "/ics/stats/overview",
    auth: "plugin",
    handler: async (req, res) => {
      const { createStatsHandler } = await import("./handlers/stats.js");
      return createStatsHandler(runtime)(req, res);
    },
  });

}
