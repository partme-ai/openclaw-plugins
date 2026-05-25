/**
 * @module web-socket/transport/gateway-ws
 *
 * Gateway 账号生命周期：按 mode 启动客户端 / 服务端 / 双模式。
 */

import type { ChannelAccountSnapshot, ChannelGatewayContext } from "openclaw/plugin-sdk";

import { handleInboundMessage } from "../inbound.js";
import {
  configureSessionExpiry,
  handleConnectionDisconnected,
  markConnectionConnected,
} from "../routing/session-mapper.js";
import {
  isClientModeEnabled,
  isServerModeEnabled,
  resolveOpenClawDmScope,
  resolveWebsocketConfig,
  type ResolvedWebsocketAccount,
} from "../config.js";
import { setWebsocketChannelConfig } from "../state/web-socket-state.js";
import { startWebSocketClient, stopWebSocketClient } from "./client.js";
import { startWebSocketServer, stopWebSocketServer } from "./server.js";

/**
 * 等待 Gateway abort 信号。
 */
function waitForAbortSignal(abortSignal: AbortSignal): Promise<void> {
  if (abortSignal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const onAbort = () => {
      abortSignal.removeEventListener("abort", onAbort);
      resolve();
    };
    abortSignal.addEventListener("abort", onAbort, { once: true });
  });
}

const inboundHandler = (message: Parameters<typeof handleInboundMessage>[0]) => {
  void handleInboundMessage(message);
};

/**
 * 长驻监控：按 mode 启动传输层直至 abort。
 */
export async function monitorWebSocketChannel(
  ctx: ChannelGatewayContext<ResolvedWebsocketAccount>,
): Promise<void> {
  try {
    const globalConfig = ctx.cfg as unknown as Record<string, unknown>;
    const config = resolveWebsocketConfig(globalConfig);
    const dmScope = resolveOpenClawDmScope(globalConfig);
    setWebsocketChannelConfig(config, dmScope);
    configureSessionExpiry(
      config.session.maxExpirySeconds,
      config.session.persistentAcrossReconnect,
    );

    if (isClientModeEnabled(config)) {
      if (!config.client.url?.trim()) {
        throw new Error("channels.web-socket.client.url (or url) is required for client/both mode");
      }
      await startWebSocketClient(
        config,
        inboundHandler,
        markConnectionConnected,
        handleConnectionDisconnected,
      );
      ctx.log?.info?.(
        `[${ctx.account.accountId}] WebSocket client connecting to ${config.client.url}`,
      );
    }

    if (isServerModeEnabled(config)) {
      await startWebSocketServer(
        config,
        inboundHandler,
        markConnectionConnected,
        handleConnectionDisconnected,
      );
      ctx.log?.info?.(
        `[${ctx.account.accountId}] WebSocket server ws://${config.server.host}:${config.server.wsPort}${config.server.path}`,
      );
    }

    ctx.setStatus({
      accountId: ctx.account.accountId,
      running: true,
      configured: true,
      lastStartAt: Date.now(),
      webhookPath: "/web-socket/status",
      port: isServerModeEnabled(config) ? config.server.wsPort : undefined,
    } as ChannelAccountSnapshot);

    await waitForAbortSignal(ctx.abortSignal);
  } catch (err) {
    ctx.setStatus({
      accountId: ctx.account.accountId,
      running: false,
      lastError: String(err),
    } as ChannelAccountSnapshot);
    throw err;
  } finally {
    await stopWebSocketClient();
    await stopWebSocketServer();
    setWebsocketChannelConfig(null);
    ctx.setStatus({
      accountId: ctx.account.accountId,
      running: false,
      lastStopAt: Date.now(),
    } as ChannelAccountSnapshot);
  }
}
