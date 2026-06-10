/**
 * @module web-socket/transport/client
 *
 * 基于 `ws` 的 WebSocket 客户端：连接外部 WS 服务，支持自动重连。
 */

import WebSocket from "ws";

import type { WebsocketChannelConfig, WebsocketConnectionInfo } from "../types.js";
import {
  parseClientFrame,
  serializeErrorFrame,
  serializePongFrame,
} from "../protocol.js";
import type { WebsocketInboundCallback } from "./server.js";
import {
  registerConnection,
  unregisterConnection,
} from "./connection-hub.js";

/** 客户端连接 id 前缀 */
export const WS_CLIENT_CONNECTION_PREFIX = "client:";

let clientSocket: WebSocket | null = null;
let clientConnectionId: string | null = null;
let clientRunning = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let onInboundMessage: WebsocketInboundCallback | null = null;
let activeClientConfig: WebsocketChannelConfig | null = null;
let abortConnect = false;

/**
 * 构建带 token 的 WebSocket URL（query 参数）。
 */
function buildClientUrl(config: WebsocketChannelConfig): string {
  const url = config.client.url?.trim();
  if (!url) {
    throw new Error("channels.web-socket.client.url is required in client/both mode");
  }
  if (!config.client.token?.trim()) {
    return url;
  }
  const parsed = new URL(url);
  if (!parsed.searchParams.has("token")) {
    parsed.searchParams.set("token", config.client.token.trim());
  }
  return parsed.toString();
}

/**
 * 构建客户端 WebSocket 握手 headers。
 */
function buildClientHeaders(config: WebsocketChannelConfig): Record<string, string> {
  const headers = { ...config.client.headers };
  if (config.client.token?.trim() && !headers.Authorization) {
    headers.Authorization = `Bearer ${config.client.token.trim()}`;
  }
  return headers;
}

/**
 * 解析客户端 mode 下的固定 connectionId。
 */
export function resolveClientConnectionId(config: WebsocketChannelConfig): string {
  const id = config.client.clientId.trim() || "default";
  return `${WS_CLIENT_CONNECTION_PREFIX}${id}`;
}

/**
 * 处理客户端 socket 入站 message。
 */
function attachClientMessageHandler(
  ws: WebSocket,
  connectionId: string,
  config: WebsocketChannelConfig,
): void {
  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      ws.send(serializeErrorFrame("Binary frames not supported"));
      return;
    }
    const raw = data.toString("utf-8");
    const parsed = parseClientFrame(raw);
    if (parsed === "ping") {
      ws.send(serializePongFrame());
      return;
    }
    if (!parsed) {
      return;
    }
    onInboundMessage?.({
      connectionId,
      rawPayload: raw,
      frameAgentId: parsed.agentId,
      messageId: parsed.messageId,
      peerId: parsed.peerId,
    });
  });
}

/**
 * 调度客户端重连（指数退避）。
 */
function scheduleReconnect(
  config: WebsocketChannelConfig,
  onConnect?: (connectionId: string) => void,
  onDisconnect?: (connectionId: string) => void,
): void {
  if (abortConnect || !config.client.reconnect.enabled) {
    return;
  }
  const delay = Math.min(
    config.client.reconnect.initialDelayMs * 2 ** reconnectAttempt,
    config.client.reconnect.maxDelayMs,
  );
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    void connectOnce(config, onConnect, onDisconnect);
  }, delay);
}

/**
 * 建立单次客户端连接。
 */
function connectOnce(
  config: WebsocketChannelConfig,
  onConnect?: (connectionId: string) => void,
  onDisconnect?: (connectionId: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = buildClientUrl(config);
    const connectionId = resolveClientConnectionId(config);
    const headers = buildClientHeaders(config);

    const ws = new WebSocket(url, config.client.protocols, {
      headers,
      maxPayload: config.limits.maxPayloadBytes,
    });

    ws.on("open", () => {
      clientSocket = ws;
      clientConnectionId = connectionId;
      reconnectAttempt = 0;
      registerConnection(connectionId, ws, {
        connectedAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        remoteAddress: url,
      });
      attachClientMessageHandler(ws, connectionId, config);
      onConnect?.(connectionId);
      console.log(`[openclaw-web-socket] Client connected to ${url} as ${connectionId}`);
      resolve();
    });

    ws.on("error", (err) => {
      console.error(`[openclaw-web-socket] Client socket error (${connectionId}):`, err);
      if (ws.readyState === WebSocket.CONNECTING) {
        reject(err);
      }
    });

    const cleanup = () => {
      unregisterConnection(connectionId);
      if (clientConnectionId === connectionId) {
        clientConnectionId = null;
        clientSocket = null;
      }
      onDisconnect?.(connectionId);
      console.log(`[openclaw-web-socket] Client disconnected: ${connectionId}`);
      if (clientRunning && !abortConnect) {
        scheduleReconnect(config, onConnect, onDisconnect);
      }
    };

    ws.on("close", cleanup);
  });
}

/**
 * 启动 WebSocket 客户端（连接外部服务，可选自动重连）。
 */
export async function startWebSocketClient(
  config: WebsocketChannelConfig,
  messageHandler: WebsocketInboundCallback,
  onConnect?: (connectionId: string) => void,
  onDisconnect?: (connectionId: string) => void,
): Promise<void> {
  if (clientRunning) {
    return;
  }
  abortConnect = false;
  clientRunning = true;
  onInboundMessage = messageHandler;
  activeClientConfig = config;

  try {
    await connectOnce(config, onConnect, onDisconnect);
  } catch (err) {
    if (config.client.reconnect.enabled && !abortConnect) {
      scheduleReconnect(config, onConnect, onDisconnect);
      return;
    }
    clientRunning = false;
    throw err;
  }
}

/**
 * 停止 WebSocket 客户端并取消重连。
 */
export async function stopWebSocketClient(): Promise<void> {
  abortConnect = true;
  clientRunning = false;
  onInboundMessage = null;
  activeClientConfig = null;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (clientSocket) {
    try {
      clientSocket.close();
    } catch {
      /* ignore */
    }
  }
  clientSocket = null;
  if (clientConnectionId) {
    unregisterConnection(clientConnectionId);
    clientConnectionId = null;
  }
  reconnectAttempt = 0;
}

/**
 * 客户端运行状态。
 */
export function getClientStats(): {
  running: boolean;
  connected: boolean;
  url: string | null;
  connectionId: string | null;
} {
  return {
    running: clientRunning,
    connected: clientSocket?.readyState === WebSocket.OPEN,
    url: activeClientConfig?.client.url ?? null,
    connectionId: clientConnectionId,
  };
}

/**
 * 客户端连接元信息（状态 API）。
 */
export function getClientConnectionInfo(): WebsocketConnectionInfo | null {
  if (!clientConnectionId) {
    return null;
  }
  return {
    connectionId: clientConnectionId,
    connectedAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    remoteAddress: activeClientConfig?.client.url,
  };
}
