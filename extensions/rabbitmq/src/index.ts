/**
 * @fileoverview openclaw-rabbitmq 插件聚合导出面（门面模块）。
 *
 * @description
 * 本文件位于插件包的公开 API 边界：通过 `defineChannelPluginEntry` 注册 RabbitMQ
 * Channel 插件、注入 Runtime，并在 full 模式下暴露健康检查、统计与状态 HTTP 路由。
 * Base Profile / 宿主在加载插件时从本入口获取稳定符号。
 *
 * @module index
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
 * @description Channel 插件默认导出：`defineChannelPluginEntry` 注册契约，含 full 模式 HTTP 路由。
 * @see ./channel.js
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
