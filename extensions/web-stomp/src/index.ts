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

/**
 * 兼容无 registerService 的宿主：直接 start / onReady / 延迟 fallback。
 */
function registerStompWsService(api: OpenClawPluginApi, start: () => Promise<void>): void {
  const withService = api as OpenClawPluginApi & {
    registerService?: (svc: { id: string; start: () => Promise<void>; stop?: () => Promise<void> }) => void;
  };
  if (typeof withService.registerService !== "function") {
    void start();
    return;
  }
  withService.registerService({
    id: "openclaw-web-stomp-server",
    start: async () => {
      await start();
    },
    stop: async () => {
      await stopStompServer();
    },
  });
}

export default defineChannelPluginEntry({
  id: "openclaw-web-stomp",
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
        console.log("[openclaw-web-stomp] STOMP server started successfully");
      } catch (err) {
        console.error("[openclaw-web-stomp] Failed to start STOMP server:", err);
      }
    });

    console.log("[openclaw-web-stomp] Plugin registered — STOMP channel ready");
    console.log("[openclaw-web-stomp] Endpoints:");
    console.log("  /stomp/status — Server status & connections");
  },
});

/**
 * STOMP 入站 SEND 帧回调：记录日志并异步 dispatch 到 OpenClaw inbound 管道。
 */
function handleInboundMessage(ctx: import("./inbound.js").WebStompInboundContext): void {
  console.log(
    `[openclaw-web-stomp] Inbound: agent=${ctx.agentId}, peer=${ctx.peerId}, destination=${ctx.destination}`,
  );
  dispatchInboundStomp(ctx).catch((error) => {
    console.error(`[openclaw-web-stomp] Runtime dispatch failed for peer=${ctx.peerId}:`, error);
  });
}

process.on("SIGTERM", async () => {
  console.log("[openclaw-web-stomp] Shutting down...");
  await stopStompServer();
});
