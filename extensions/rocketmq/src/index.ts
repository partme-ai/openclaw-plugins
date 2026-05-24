/**
 * @fileoverview OpenClaw RocketMQ 插件聚合导出面（Channel 插件入口）。
 *
 * @description
 * 本文件位于 `openclaw-rocketmq` 包的公开 API 边界：注册 RocketMQ Channel、注入 Runtime，
 * 并挂载 `/rocketmq/health`、`/rocketmq/stats`、`/rocketmq/status` 诊断 HTTP 路由。
 * Base Profile / 宿主在加载插件时从本入口获取 Channel 定义与生命周期钩子。
 *
 * @module index
 */

/**
 * openclaw-rocketmq — RocketMQ 渠道插件
 *
 * 功能：
 * 1. PushConsumer 入站消费 → Topic/Tag 路由 → OpenClaw Agent 分发
 * 2. Producer 出站发送 → 会话 replyTopic 回复
 * 3. 诊断路由 — health / stats / status 快照
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { rockermqChannel } from "./channel.js";
import { setRockermqRuntime } from "./runtime.js";
import { buildRockermqConfigSnapshot, resolveRockermqConfig } from "./config.js";
import { getRockermqChannelConfig } from "./state/state.js";
import { getSessionStats, getAllSessionMappings } from "./routing/session-mapper.js";
import { getStats } from "./transport/server.js";

export { rockermqChannel } from "./channel.js";

/** @description RocketMQ Channel 插件注册入口。 */
export default defineChannelPluginEntry({
  id: "openclaw-rocketmq",
  name: "OpenClaw RocketMQ",
  description: "OpenClaw RocketMQ channel plugin with producer and push-consumer support.",
  plugin: rockermqChannel,
  setRuntime: setRockermqRuntime,
  registerFull(api: OpenClawPluginApi) {

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
