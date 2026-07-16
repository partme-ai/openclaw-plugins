/**
 * @fileoverview STOMP over WebSocket 插件的 OpenClaw 注册入口。
 *
 * 组合 Channel、Runtime 和协议 Server，并暴露受插件认证保护的连接、订阅、ACK 与脱敏配置
 * 状态端点；具体协议处理和消息路由分别留在 transport 与 inbound 模块。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

import { stompChannel } from "./channel.js";
import { buildStompConfigSnapshot } from "./config.js";
import { setWebStompRuntime } from "./runtime.js";
import { getAckStats } from "./transport/ack-handler.js";
import { getSubscriptionStats } from "./transport/subscription-mgr.js";
import { getActiveStompConfig, getConnectionInfoList, getStompServerStats } from "./transport/server.js";

export default defineChannelPluginEntry({
  id: "web-stomp",
  name: "STOMP over WebSocket",
  description: "STOMP 1.2 over WebSocket/WSS bridge for OpenClaw",
  plugin: stompChannel,
  setRuntime: setWebStompRuntime,
  registerFull(api: OpenClawPluginApi) {
    api.registerHttpRoute({
      path: "/stomp/status",
      auth: "plugin",
      match: "prefix",
      handler: async (_req: IncomingMessage, res: ServerResponse) => {
        const config = getActiveStompConfig();
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({
          ok: true,
          data: {
            server: getStompServerStats(),
            connections: getConnectionInfoList(),
            subscriptions: getSubscriptionStats(),
            ack: getAckStats(),
            config: config ? buildStompConfigSnapshot(config) : null,
          },
        }));
      },
    });
  },
});

export { stompChannel } from "./channel.js";
export { resolveStompWsConfig, validateStompWsConfig } from "./config.js";
