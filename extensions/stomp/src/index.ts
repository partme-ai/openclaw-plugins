/**
 * @fileoverview OpenClaw STOMP 插件聚合导出面（stomp-tcp Channel 入口）。
 *
 * @description
 * 注册 STOMP TCP Channel、注入 Runtime、挂载 `/stomp-tcp/status` 诊断路由，
 * 并通过 `registerService` 启动进程内嵌 STOMP Server。
 *
 * @module index
 */

/**
 * openclaw-stomp — 原生 TCP STOMP 渠道插件。
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

/** @description STOMP TCP Channel 插件 defineChannelPluginEntry 注册入口。 */
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

/**
 * @description 注册 STOMP 后台服务；宿主无 registerService 时直接 start。
 * @param api - OpenClaw 插件 API。
 * @param start - 服务启动函数。
 * @returns void
 * @throws 不抛出。
 */
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

/**
 * @description transport 入站回调：异步 dispatch 至 OpenClaw（错误仅打日志）。
 * @param message - 归一化后的 STOMP 入站消息。
 * @returns void
 * @throws 不抛出；dispatch 异常被 catch。
 */
function handleInbound(message: InboundMessage): void {
  dispatchInboundMessage(message).catch((error) => {
    console.error("[openclaw-stomp] Runtime dispatch failed:", error);
  });
}

process.on("SIGTERM", async () => {
  await stopStompTcpServer();
});
