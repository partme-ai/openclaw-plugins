/** Native STOMP TCP/TLS plugin entry. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
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
