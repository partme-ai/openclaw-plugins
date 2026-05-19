/**
 * openclaw-stomp 插件入口。
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

import { stompTcpChannel } from "./channel.js";
import { setStompRuntime, getStompRuntime } from "./runtime.js";
import {
  getConnectionInfoList,
  getConnectionStats,
  getStatusSnapshot,
  publishToDestination,
  startStompTcpServer,
  stopStompTcpServer,
} from "./stomp-server.js";
import type { InboundMessage, StompTcpConfig, TopicBinding } from "./types.js";

const DEFAULT_CONFIG: StompTcpConfig = {
  port: 61613,
  tlsPort: 61614,
  tls: { enabled: false },
  heartbeat: { serverMs: 10_000, clientMs: 10_000 },
  maxConnections: 1000,
  maxFrameSize: 1024 * 1024 * 4,
  auth: { required: true },
  subscribeTopics: [],
  topicBindings: [],
  defaultAckMode: "auto",
  prefetchCount: 100,
};

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
      const config = resolveConfig(runtimeCfg);
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
  dispatchToRuntime(message).catch((error) => {
    console.error("[openclaw-stomp] Runtime dispatch failed:", error);
  });
}

async function dispatchToRuntime(message: InboundMessage): Promise<void> {
  const runtime = getStompRuntime();
  const cfg = runtime.config;
  const route = await runtime.channel.routing.resolveAgentRoute({
    cfg,
    channel: "stomp-tcp",
    accountId: message.accountId,
    peer: { kind: "direct", id: message.peerId },
  });
  const resolvedAgentId =
    typeof route.agentId === "string" && route.agentId.trim().length > 0
      ? route.agentId
      : message.agentId;
  const sessionKey = route.sessionKey;
  const replyDestination = message.replyDestination ?? `/topic/session.${sessionKey}`;
  const ctx = await runtime.channel.reply.finalizeInboundContext({
    channel: "stomp-tcp",
    accountId: message.accountId,
    from: message.peerId,
    text: message.text,
    chatType: "direct",
    extra: {
      stompDestination: message.destination,
      stompReplyDestination: replyDestination,
      sessionKey,
    },
  });
  const dispatcher = runtime.channel.reply.createReplyDispatcherWithTyping({
    deliver: async (payload: { text: string }) => {
      publishToDestination(replyDestination, payload.text);
    },
  });
  await runtime.channel.reply.dispatchReplyFromConfig({
    ctx,
    cfg,
    dispatcher,
    replyOptions: route,
  });
}

function resolveConfig(globalConfig: Record<string, unknown>): StompTcpConfig {
  const channels = (globalConfig.channels as Record<string, unknown> | undefined) ?? {};
  const cfg = (channels["stomp-tcp"] as Partial<StompTcpConfig> | undefined) ?? {};
  return {
    port: cfg.port ?? DEFAULT_CONFIG.port,
    tlsPort: cfg.tlsPort ?? DEFAULT_CONFIG.tlsPort,
    tls: {
      enabled: cfg.tls?.enabled ?? DEFAULT_CONFIG.tls.enabled,
      certFile: cfg.tls?.certFile,
      keyFile: cfg.tls?.keyFile,
      caFile: cfg.tls?.caFile,
    },
    heartbeat: {
      serverMs: cfg.heartbeat?.serverMs ?? DEFAULT_CONFIG.heartbeat.serverMs,
      clientMs: cfg.heartbeat?.clientMs ?? DEFAULT_CONFIG.heartbeat.clientMs,
    },
    maxConnections: cfg.maxConnections ?? DEFAULT_CONFIG.maxConnections,
    maxFrameSize: cfg.maxFrameSize ?? DEFAULT_CONFIG.maxFrameSize,
    auth: {
      required: cfg.auth?.required ?? DEFAULT_CONFIG.auth.required,
      defaultUser: cfg.auth?.defaultUser,
      defaultPass: cfg.auth?.defaultPass,
    },
    subscribeTopics: Array.isArray(cfg.subscribeTopics) ? cfg.subscribeTopics : DEFAULT_CONFIG.subscribeTopics,
    topicBindings: normalizeTopicBindings(cfg.topicBindings),
    defaultAckMode: cfg.defaultAckMode ?? DEFAULT_CONFIG.defaultAckMode,
    prefetchCount: cfg.prefetchCount ?? DEFAULT_CONFIG.prefetchCount,
  };
}

function normalizeTopicBindings(input: unknown): TopicBinding[] {
  if (!Array.isArray(input)) return [];
  const result: TopicBinding[] = [];
  for (const row of input) {
    if (!row || typeof row !== "object") continue;
    const candidate = row as Partial<TopicBinding>;
    if (!candidate.topicPattern || !candidate.agentId) continue;
    result.push({
      topicPattern: candidate.topicPattern,
      agentId: candidate.agentId,
      accountId: candidate.accountId,
      replyTopic: candidate.replyTopic,
    });
  }
  return result;
}

process.on("SIGTERM", async () => {
  await stopStompTcpServer();
});
