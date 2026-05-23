/**
 * openclaw-stomp 插件入口。
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

import { stompTcpChannel } from "./channel.js";
import { resolveStompTcpConfig } from "./config.js";
import { setStompRuntime } from "./runtime.js";
import {
  getConnectionInfoList,
  getConnectionStats,
  getStatusSnapshot,
  startStompTcpServer,
  stopStompTcpServer,
} from "./transport/server.js";
import { dispatchInboundMessage } from "./inbound.js";
import type { InboundMessage } from "./types.js";

export default defineChannelPluginEntry({
  id: "openclaw-stomp",
  name: "STOMP TCP",
  description: "OpenClaw STOMP TCP channel plugin with topic binding and enterprise delivery controls",
  plugin: stompTcpChannel,
  setRuntime: setStompRuntime,
  registerFull(api: OpenClawPluginApi) {
    api.registerHttpRoute({
      path: "/stomp-tcp/status",
      auth: "plugin",
      match: "prefix",
      handler: async (_req: IncomingMessage, res: ServerResponse) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              connections: getConnectionInfoList(),
              stats: getConnectionStats(),
              snapshot: getStatusSnapshot(),
            },
          }),
        );
      },
    });

    registerStompService(api, async () => {
      const runtimeCfg = (api.runtime as { config: Record<string, unknown> }).config;
      const config = resolveStompTcpConfig(runtimeCfg);
      await startStompTcpServer(config, handleInbound);
      console.log("[openclaw-stomp] TCP STOMP server started");
    });
  },
});

function registerStompService(api: OpenClawPluginApi, start: () => Promise<void>): void {
  const withService = api as OpenClawPluginApi & {
    registerService?: (svc: { id: string; start: () => Promise<void>; stop?: () => Promise<void> }) => void;
  };
  if (typeof withService.registerService !== "function") {
    void start();
    return;
  }
  withService.registerService({
    id: "openclaw-stomp-tcp",
    start,
    stop: async () => {
      await stopStompTcpServer();
    },
  });
}

function handleInbound(message: InboundMessage): void {
  dispatchInboundMessage(message).catch((error) => {
    console.error("[openclaw-stomp] Runtime dispatch failed:", error);
  });
}

process.on("SIGTERM", async () => {
  await stopStompTcpServer();
});
