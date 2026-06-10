/**
 * @fileoverview openclaw-web-socket 插件入口。
 *
 * @module web-socket
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

import { resolveWebsocketConfig } from "./config.js";
import { webSocketPlugin } from "./runtime/web-socket-plugin.js";
import { getSessionStats } from "./routing/session-mapper.js";
import { setWebsocketRuntime } from "./runtime.js";
import {
  getWebsocketChannelConfig,
  getWebsocketPolicyMeta,
} from "./state/web-socket-state.js";
import { getAllConnectionInfo } from "./transport/connection-hub.js";
import { getClientStats } from "./transport/client.js";
import { getConnectedClients, getServerStats } from "./transport/server.js";

export { webSocketPlugin } from "./runtime/web-socket-plugin.js";
export { resolveWebsocketConfig } from "./config.js";
export type { ResolvedWebsocketAccount } from "./config.js";

export default defineChannelPluginEntry({
  id: "web-socket",
  name: "WebSocket",
  description:
    "OpenClaw WebSocket channel — client (connect outbound) and/or server (embedded ws) with JSON frames",
  plugin: webSocketPlugin,
  setRuntime: setWebsocketRuntime,
  registerFull(api: OpenClawPluginApi) {
    api.registerHttpRoute({
      path: "/web-socket/status",
      handler: async (_req: IncomingMessage, res: ServerResponse) => {
        const serverStats = getServerStats();
        const clientStats = getClientStats();
        const sessionStats = getSessionStats();
        const serverClients = getConnectedClients();
        const allConnections = getAllConnectionInfo();
        const policyMeta = getWebsocketPolicyMeta();
        const config = getWebsocketChannelConfig();

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              mode: config?.mode ?? null,
              server: serverStats,
              client: clientStats,
              sessions: sessionStats,
              serverClients,
              connections: allConnections,
              config,
              policy: policyMeta,
            },
          }),
        );
      },
      auth: "plugin",
      match: "prefix",
    });

    console.log("[openclaw-web-socket] Plugin registered — WebSocket channel ready");
    console.log("[openclaw-web-socket] Endpoints: /web-socket/status");
  },
});

process.on("SIGTERM", async () => {
  console.log("[openclaw-web-socket] Shutting down...");
  const { stopWebSocketClient } = await import("./transport/client.js");
  const { stopWebSocketServer } = await import("./transport/server.js");
  await stopWebSocketClient();
  await stopWebSocketServer();
});
