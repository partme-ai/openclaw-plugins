/**
 * openclaw-redis-stream 入口。
 *
 * 注册 Redis Channel/Stream channel plugin ——
 * 支持 Redis Pub/Sub channel 消息接收（多 topic 订阅 + agent 绑定）和
 * Redis Stream 消费组模式，会话隔离完全使用 OpenClaw dmScope。
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import type {
  OpenClawPluginApi,
  PluginRuntime,
} from "openclaw/plugin-sdk/core";
import { redisStreamChannel } from "./channel.js";
import { getStats } from "./transport/server.js";
import { resolveRedisChannelConfig, redactUrl } from "./config.js";
import { setRedisStreamRuntime } from "./runtime.js";
import { getSessionStats } from "./routing/session-mapper.js";

export default defineChannelPluginEntry({
  id: "openclaw-redis-stream",
  name: "Redis Stream",
  description:
    "Redis Pub/Sub channel + Stream consumer group integration for OpenClaw.",

  plugin: redisStreamChannel,

  setRuntime(runtime: PluginRuntime) {
    setRedisStreamRuntime(runtime);
  },

  registerCliMetadata(api: OpenClawPluginApi) {
    api.registerCli(
      () => {
        // Redis Stream 目前只声明 CLI 元数据；命令实现由后续 CLI surface 接入。
      },
      {
        descriptors: [
          {
            name: "redis-stream",
            description: "Redis Stream channel status",
            hasSubcommands: false,
          },
        ],
      },
    );
  },

  registerFull(api: OpenClawPluginApi) {
    // 健康检查
    api.registerHttpRoute({
      path: "/redis-stream/health",
      auth: "plugin",
      match: "prefix",
      async handler(_req: IncomingMessage, res: ServerResponse) {
        const s = getStats();
        res.writeHead(s.connected ? 200 : 503, {
          "Content-Type": "application/json",
        });
        res.end(
          JSON.stringify({
            ok: true,
            healthy: s.connected,
            data: s,
            sessions: getSessionStats(),
          }),
        );
      },
    });

    // 状态详情
    api.registerHttpRoute({
      path: "/redis-stream/status",
      auth: "plugin",
      match: "prefix",
      async handler(_req: IncomingMessage, res: ServerResponse) {
        const cfg = (api.runtime?.config ?? {}) as Record<string, unknown>;
        const config = resolveRedisChannelConfig(cfg);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              stats: getStats(),
              config: {
                url: redactUrl(config.url),
                channelMode: config.channelMode,
                subscribeChannels: config.subscribeChannels,
                channelBindings: config.channelBindings,
              },
              sessions: getSessionStats(),
            },
          }),
        );
      },
    });
  },
});
