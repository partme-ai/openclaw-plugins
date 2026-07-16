/**
 * @fileoverview 原生 STOMP TCP/TLS 插件的 OpenClaw 注册入口。
 *
 * 组合 Channel、Runtime 和协议 Server，并注册仅插件认证可访问的状态端点。端点展示连接、
 * 订阅和脱敏配置快照，不返回登录密码或密码散列。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

import { stompTcpChannel } from "./channel.js";
import { buildStompTcpConfigSnapshot } from "./config.js";
import { setStompRuntime } from "./runtime.js";
import {
  getActiveStompTcpConfig,
  getConnectionInfoList,
  getConnectionStats,
  getStatusSnapshot,
} from "./transport/server.js";

export default defineChannelPluginEntry({
  id: "stomp",
  name: "OpenClaw STOMP TCP",
  description: "Authenticated STOMP 1.2 over TCP/TLS for OpenClaw",
  plugin: stompTcpChannel,
  setRuntime: setStompRuntime,
  registerFull(api: OpenClawPluginApi) {
    api.registerHttpRoute({
      path: "/stomp-tcp/status",
      auth: "plugin",
      match: "exact",
      handler: async (_req: IncomingMessage, res: ServerResponse) => {
        const config = getActiveStompTcpConfig();
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({
          ok: true,
          data: {
            connections: getConnectionInfoList(),
            stats: getConnectionStats(),
            snapshot: getStatusSnapshot(),
            config: config ? buildStompTcpConfigSnapshot(config) : null,
          },
        }));
      },
    });
  },
});

export { stompTcpChannel } from "./channel.js";
export {
  assertValidStompTcpConfig,
  buildStompTcpConfigSnapshot,
  resolveStompTcpConfig,
  validateStompTcpConfig,
} from "./config.js";
