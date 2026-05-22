/**
 * openclaw-rocketmq 入口。
 * 使用 defineChannelPluginEntry 注册 channel，并在 full 模式暴露状态路由。
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { rockermqChannel } from "./channel.js";
import { setRockermqRuntime } from "./runtime.js";
import { buildRockermqConfigSnapshot, resolveRockermqConfig } from "./config.js";
import { getRockermqChannelConfig } from "./state.js";
import { getSessionStats, getAllSessionMappings } from "./routing/session-mapper.js";
import { getStats } from "./transport/server.js";
import { registerRockermqTools } from "./mq-tools.js";

export { rockermqChannel } from "./channel.js";

/**
 * 注册 RocketMQ channel plugin。
 */
export default defineChannelPluginEntry({
  id: "openclaw-rocketmq",
  name: "RocketMQ",
  description: "OpenClaw RocketMQ channel plugin with producer and push-consumer support.",
  plugin: rockermqChannel,
  setRuntime: setRockermqRuntime,
  registerFull(api: OpenClawPluginApi) {
    registerRockermqTools(api);

    api.registerHttpRoute({
      path: "/rocketmq/health",
      auth: "plugin",
      match: "prefix",
      async handler(_req: IncomingMessage, res: ServerResponse) {
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
      path: "/rocketmq/stats",
      auth: "plugin",
      match: "prefix",
      async handler(_req: IncomingMessage, res: ServerResponse) {
        const response = {
          ok: true,
          data: {
            stats: getStats(),
            sessions: getSessionStats(),
          },
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
      },
    });

    api.registerHttpRoute({
      path: "/rocketmq/status",
      auth: "plugin",
      match: "prefix",
      async handler(_req: IncomingMessage, res: ServerResponse) {
        const runtimeConfig = resolveRockermqConfig(
          ((api.runtime as { config?: Record<string, unknown> })?.config ?? {}) as Record<
            string,
            unknown
          >,
        );
        const activeConfig = getRockermqChannelConfig() ?? runtimeConfig;
        const response = {
          ok: true,
          data: {
            stats: getStats(),
            sessions: getSessionStats(),
            mappings: getAllSessionMappings(),
            config: buildRockermqConfigSnapshot(activeConfig),
          },
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
      },
    });
  },
});
