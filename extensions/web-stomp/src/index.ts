/**
 * openclaw-web-stomp 插件入口 — STOMP over WebSocket
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

import { stompChannel } from "./channel.js";
import { resolveStompWsConfig } from "./config.js";
import { setWebStompRuntime } from "./runtime.js";
import { dispatchInboundStomp } from "./inbound.js";
import { startStompServer, stopStompServer, getConnectionInfoList } from "./transport/server.js";
import { getSubscriptionStats } from "./transport/subscription-mgr.js";
import { getAckStats } from "./transport/ack-handler.js";

function registerStompWsService(api: OpenClawPluginApi, start: () => Promise<void>): void {
  const withService = api as OpenClawPluginApi & {
    registerService?: (svc: { id: string; start: () => Promise<void>; stop?: () => Promise<void> }) => void;
  };
  if (typeof withService.registerService !== "function") {
    void start();
    return;
  }
  withService.registerService({
    id: "openclaw_web_stomp-server",
    start: async () => {
      await start();
    },
    stop: async () => {
      await stopStompServer();
    },
  });
}

export default defineChannelPluginEntry({
  id: "openclaw_web_stomp",
  name: "STOMP over WebSocket",
  description: "STOMP over WebSocket bridge for OpenClaw enterprise integration",
  plugin: stompChannel,
  setRuntime: setWebStompRuntime,
  registerFull(api: OpenClawPluginApi) {
    api.registerHttpRoute({
      path: "/stomp/status",
      auth: "plugin",
      match: "prefix",
      handler: async (_req: IncomingMessage, res: ServerResponse) => {
        const connections = getConnectionInfoList();
        const subscriptionStats = getSubscriptionStats();
        const ackStats = getAckStats();

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              connections,
              subscriptions: subscriptionStats,
              ack: ackStats,
            },
          }),
        );
      },
    });

    registerStompWsService(api, async () => {
      const runtimeCfg = (api.runtime as { config: Record<string, unknown> }).config;
      const config = resolveStompWsConfig(runtimeCfg);
      try {
        await startStompServer(config, handleInboundMessage);
        console.log("[openclaw_web_stomp] STOMP server started successfully");
      } catch (err) {
        console.error("[openclaw_web_stomp] Failed to start STOMP server:", err);
      }
    });

    console.log("[openclaw_web_stomp] Plugin registered — STOMP channel ready");
    console.log("[openclaw_web_stomp] Endpoints:");
    console.log("  /stomp/status — Server status & connections");
  },
});

function handleInboundMessage(ctx: import("./inbound.js").WebStompInboundContext): void {
  console.log(
    `[openclaw_web_stomp] Inbound: agent=${ctx.agentId}, peer=${ctx.peerId}, destination=${ctx.destination}`,
  );
  dispatchInboundStomp(ctx).catch((error) => {
    console.error(`[openclaw_web_stomp] Runtime dispatch failed for peer=${ctx.peerId}:`, error);
  });
}

process.on("SIGTERM", async () => {
  console.log("[openclaw_web_stomp] Shutting down...");
  await stopStompServer();
});
