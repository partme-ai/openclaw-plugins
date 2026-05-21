/**
 * openclaw-web-stomp 插件入口 — STOMP over WebSocket
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { PluginApi, StompServerConfig, GatewayRuntime } from "./types.js";
import { stompChannel } from "./channel.js";
import { startStompServer, stopStompServer, getConnectionInfoList } from "./stomp-server.js";
import { getSubscriptionStats } from "./subscription-mgr.js";
import { getAckStats } from "./ack-handler.js";

let _runtime: GatewayRuntime | null = null;

function registerStompWsService(api: PluginApi, start: () => Promise<void>): void {
  const withService = api as PluginApi & {
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

const DEFAULT_CONFIG: StompServerConfig = {
  wsPort: 15674,
  path: "/ws",
  heartbeatIncoming: 10_000,
  heartbeatOutgoing: 10_000,
  maxConnections: 500,
};

/**
 * 旧版兼容入口：直接导出 register(api)。
 */
export default function register(api: PluginApi): void {
    _runtime = api.runtime as GatewayRuntime;

    api.registerHttpRoute({
      path: "/stomp/status",
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
      const config = resolveStompConfig(runtimeCfg);
      try {
        await startStompServer(config, handleInboundMessage);
        console.log("[openclaw_web_stomp] STOMP server started successfully");
      } catch (err) {
        console.error("[openclaw_web_stomp] Failed to start STOMP server:", err);
      }
    });

    console.log("[openclaw_web_stomp] Plugin registered — STOMP channel ready");
    api.registerChannel({ plugin: stompChannel });
    console.log("[openclaw_web_stomp] Endpoints:");
    console.log("  /stomp/status — Server status & connections");
}

function handleInboundMessage(agentId: string, sessionKey: string, text: string): void {
  console.log(
    `[openclaw_web_stomp] Inbound: agent=${agentId}, session=${sessionKey}, text=${text.slice(0, 100)}`,
  );
  dispatchToRuntime(sessionKey, text).catch((error) => {
    console.error(`[openclaw_web_stomp] Runtime dispatch failed for session=${sessionKey}:`, error);
  });
}

/**
 * 使用 stomp-server 生成的完整 sessionKey（如 `stomp:<conn>@<agent>`）作为 peer/from，与 channel 出站 `buildSessionDestination(sessionKey)` 一致
 */
async function dispatchToRuntime(sessionKey: string, text: string): Promise<void> {
  if (!_runtime) {
    console.warn("[openclaw_web_stomp] Runtime not initialized, cannot dispatch message");
    return;
  }

  const cfg = _runtime.config;

  const route = await _runtime.channel.routing.resolveAgentRoute({
    cfg,
    channel: "stomp",
    accountId: "default",
    peer: { kind: "dm", id: sessionKey },
  });

  const ctx = await _runtime.channel.reply.finalizeInboundContext({
    channel: "stomp",
    accountId: "default",
    from: sessionKey,
    text,
    chatType: "direct",
  });

  const replyDestination = `/topic/session.${sessionKey}`;
  const dispatcher = _runtime.channel.reply.createReplyDispatcherWithTyping({
    deliver: async (payload) => {
      const { publishToDestination } = await import("./stomp-server.js");
      publishToDestination(replyDestination, payload.text);
    },
  });

  await _runtime.channel.reply.dispatchReplyFromConfig({
    ctx,
    cfg,
    dispatcher,
    replyOptions: route,
  });
}

function resolveStompConfig(globalConfig: Record<string, unknown>): StompServerConfig {
  const channels = globalConfig.channels as Record<string, unknown> | undefined;
  const stompConfig = channels?.stomp as
    | (Partial<StompServerConfig> & { port?: number })
    | undefined;

  return {
    wsPort: stompConfig?.wsPort ?? stompConfig?.port ?? DEFAULT_CONFIG.wsPort,
    path: stompConfig?.path ?? DEFAULT_CONFIG.path,
    heartbeatIncoming: stompConfig?.heartbeatIncoming ?? DEFAULT_CONFIG.heartbeatIncoming,
    heartbeatOutgoing: stompConfig?.heartbeatOutgoing ?? DEFAULT_CONFIG.heartbeatOutgoing,
    maxConnections: stompConfig?.maxConnections ?? DEFAULT_CONFIG.maxConnections,
  };
}

process.on("SIGTERM", async () => {
  console.log("[openclaw_web_stomp] Shutting down...");
  await stopStompServer();
});
