/**
 * openclaw-rabbitmq 入口。
 * 使用 defineChannelPluginEntry 注册 channel，并在 full 模式暴露状态路由。
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { rabbitmqChannel } from "./channel.js";
import { setRabbitmqRuntime } from "./runtime.js";
import { buildRabbitmqConfigSnapshot, resolveRabbitmqConfig } from "./config.js";
import { getRabbitmqChannelConfig } from "./state/state.js";
import { getSessionStats } from "./routing/session-mapper.js";
import { getStats } from "./transport/server.js";
import { registerRabbitmqTools } from "./tools/mq-tools.js";

export { rabbitmqChannel } from "./channel.js";

/**
 * channel plugin entry。
 */
export default defineChannelPluginEntry({
  id: "rabbitmq",
  name: "RabbitMQ",
  description: "OpenClaw RabbitMQ channel plugin with enterprise-grade controls.",
  plugin: rabbitmqChannel,
  setRuntime: setRabbitmqRuntime,
  registerFull(api: OpenClawPluginApi) {
    registerRabbitmqTools(api);
    api.registerHttpRoute({
      path: "/rabbitmq/health",
      auth: "plugin",
      match: "prefix",
      handler: async (_req: IncomingMessage, res: ServerResponse) => {
        const s = getStats();
        const response = {
          ok: true,
          healthy: s.connected && s.lastError === null,
          data: s,
        };
        res.writeHead(response.healthy ? 200 : 503, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
      },
    });
    api.registerHttpRoute({
      path: "/rabbitmq/stats",
      auth: "plugin",
      match: "prefix",
      handler: async (_req: IncomingMessage, res: ServerResponse) => {
        const response = { ok: true, data: { stats: getStats(), sessions: getSessionStats() } };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
      },
    });
    api.registerHttpRoute({
      path: "/rabbitmq/status",
      auth: "plugin",
      match: "prefix",
      handler: async (_req: IncomingMessage, res: ServerResponse) => {
        const runtimeConfig = resolveRabbitmqConfig(((api.runtime as { config?: Record<string, unknown> })?.config ?? {}) as Record<string, unknown>);
        const activeConfig = getRabbitmqChannelConfig() ?? runtimeConfig;
        const response = {
          ok: true,
          data: {
            stats: getStats(),
            sessions: getSessionStats(),
            config: buildRabbitmqConfigSnapshot(activeConfig),
          },
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
      },
    });
  },
});
