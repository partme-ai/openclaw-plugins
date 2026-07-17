/**
 * @fileoverview WebSocket 主动连接模式的可靠客户端传输层。
 *
 * 负责 Bearer Header、握手超时、指数退避重连、Ping/Pong 存活探测和连接中心注册。入站帧按
 * 单连接顺序串行处理，并受 payload、pending queue 和 bufferedAmount 限制；停止时取消重连、
 * 关闭 Socket 并清理活动连接，防止插件重载后继续后台连接。
 */
import WebSocket from "ws";

import { parseClientFrame, serializeErrorFrame, serializePongFrame } from "./protocol.js";
import type { WebsocketChannelConfig, WebsocketConnectionInfo } from "../types.js";
import { registerConnection, sendToConnection, touchConnection, unregisterConnection } from "./connection-hub.js";
import type { WebsocketInboundCallback } from "./server.js";
import { redactWebSocketError } from "../shared/redact.js";

export const WS_CLIENT_CONNECTION_PREFIX = "client:";

let clientSocket: WebSocket | null = null;
let clientConnectionId: string | null = null;
let clientInfo: WebsocketConnectionInfo | null = null;
let clientRunning = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectAttempt = 0;
let onInboundMessage: WebsocketInboundCallback | null = null;
let activeClientConfig: WebsocketChannelConfig | null = null;
let abortConnect = false;
/** 已被传输层接纳、但尚未完成的 Agent 入站任务；停机时必须全部排空。 */
const inboundTasks = new Set<Promise<void>>();

function trackInboundTask(task: Promise<void>): Promise<void> {
  inboundTasks.add(task);
  void task.finally(() => inboundTasks.delete(task));
  return task;
}

function buildClientHeaders(config: WebsocketChannelConfig): Record<string, string> {
  const headers = { ...config.client.headers };
  if (config.client.token?.trim() && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${config.client.token.trim()}`;
  }
  return headers;
}

export function resolveClientConnectionId(config: WebsocketChannelConfig): string {
  return `${WS_CLIENT_CONNECTION_PREFIX}${config.client.clientId.trim() || "default"}`;
}

function scheduleReconnect(
  config: WebsocketChannelConfig,
  onConnect?: (connectionId: string) => void,
  onDisconnect?: (connectionId: string) => void,
): void {
  if (abortConnect || !config.client.reconnect.enabled || reconnectTimer) return;
  const baseDelay = Math.min(config.client.reconnect.initialDelayMs * 2 ** reconnectAttempt, config.client.reconnect.maxDelayMs);
  // 对称随机抖动用于打散集群重连；最终值仍限制在 [1, maxDelayMs]，不会出现负延迟。
  const jitter = baseDelay * config.client.reconnect.jitterRatio * (Math.random() * 2 - 1);
  const delay = Math.max(1, Math.min(Math.round(baseDelay + jitter), config.client.reconnect.maxDelayMs));
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectOnce(config, onConnect, onDisconnect).catch(() => scheduleReconnect(config, onConnect, onDisconnect));
  }, delay);
  reconnectTimer.unref();
}

function connectOnce(
  config: WebsocketChannelConfig,
  onConnect?: (connectionId: string) => void,
  onDisconnect?: (connectionId: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = config.client.url?.trim();
    if (!url) return reject(new Error("channels.web-socket.client.url is required in client/both mode"));
    const connectionId = resolveClientConnectionId(config);
    const ws = new WebSocket(url, config.client.protocols, {
      headers: buildClientHeaders(config),
      maxPayload: config.limits.maxPayloadBytes,
      handshakeTimeout: config.client.connectTimeoutMs,
    });
    clientSocket = ws;
    clientConnectionId = connectionId;
    let opened = false;
    let cleaned = false;
    let pending = 0;
    let queue = Promise.resolve();
    let awaitingPongAt: number | null = null;
    let windowStart = Date.now();
    let windowMessages = 0;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      unregisterConnection(connectionId);
      if (clientConnectionId === connectionId) {
        clientConnectionId = null;
        clientSocket = null;
        clientInfo = null;
      }
      if (opened) onDisconnect?.(connectionId);
      if (clientRunning && !abortConnect) scheduleReconnect(config, onConnect, onDisconnect);
    };

    ws.once("open", () => {
      if (abortConnect) {
        ws.close(1001, "Client stopping");
        return;
      }
      opened = true;
      clientSocket = ws;
      clientConnectionId = connectionId;
      reconnectAttempt = 0;
      const now = new Date().toISOString();
      clientInfo = { connectionId, connectedAt: now, lastActiveAt: now, remoteAddress: url };
      registerConnection(connectionId, ws, clientInfo);
      onConnect?.(connectionId);
      heartbeatTimer = setInterval(() => {
        const current = Date.now();
        if (awaitingPongAt && current - awaitingPongAt > config.limits.heartbeatTimeoutMs) {
          ws.terminate();
          return;
        }
        if (ws.readyState === WebSocket.OPEN && !awaitingPongAt) {
          awaitingPongAt = current;
          ws.ping();
        }
      }, config.limits.heartbeatIntervalMs);
      heartbeatTimer.unref();
      resolve();
    });
    ws.on("pong", () => {
      awaitingPongAt = null;
      touchConnection(connectionId);
      if (clientInfo) clientInfo.lastActiveAt = new Date().toISOString();
    });
    ws.on("message", (data, isBinary) => {
      touchConnection(connectionId);
      if (clientInfo) clientInfo.lastActiveAt = new Date().toISOString();
      const now = Date.now();
      if (now - windowStart >= 60_000) {
        windowStart = now;
        windowMessages = 0;
      }
      if (++windowMessages > config.limits.messagesPerMinute) {
        ws.close(1008, "Message rate limit exceeded");
        return;
      }
      if (isBinary) {
        ws.close(1003, "Binary frames not supported");
        return;
      }
      const raw = data.toString("utf8");
      const parsed = parseClientFrame(raw);
      if (parsed === "ping") {
        sendToConnection(connectionId, serializePongFrame(), config.limits.maxBufferedBytes);
        return;
      }
      if (!parsed) {
        sendToConnection(connectionId, serializeErrorFrame("Invalid message frame"), config.limits.maxBufferedBytes);
        return;
      }
      if (pending >= config.limits.maxPendingMessages) {
        ws.close(1013, "Inbound queue full");
        return;
      }
      pending += 1;
      // 在入队时固定处理器引用。stop 会清空全局处理器以拒绝新消息，但已接纳消息不能因此静默丢失。
      const handler = onInboundMessage;
      queue = trackInboundTask(queue
        .then(() => handler?.({ connectionId, rawPayload: raw, frameAgentId: parsed.agentId, messageId: parsed.messageId, peerId: parsed.peerId }))
        .catch((error: unknown) => {
          console.error(`[openclaw-web-socket] Client inbound handler failed ${connectionId}: ${redactWebSocketError(error, config)}`);
          sendToConnection(connectionId, serializeErrorFrame("Message processing failed"), config.limits.maxBufferedBytes);
        })
        .finally(() => { pending -= 1; }));
    });
    ws.once("error", (error) => {
      if (!opened) reject(error);
      else console.error(`[openclaw-web-socket] Client socket error ${connectionId}: ${redactWebSocketError(error, config)}`);
    });
    ws.once("close", () => {
      cleanup();
      // TCP/HTTP 对端可能在握手完成前直接断开且不触发 error；必须终结启动 Promise，
      // 否则 Gateway start/stop 会永久等待一个已经不存在的连接。
      if (!opened) reject(new Error("WebSocket connection closed before handshake completed"));
    });
  });
}

/** 启动主动 WebSocket 连接，并在配置允许时由后台重连接管首次失败。 */
export async function startWebSocketClient(
  config: WebsocketChannelConfig,
  messageHandler: WebsocketInboundCallback,
  onConnect?: (connectionId: string) => void,
  onDisconnect?: (connectionId: string) => void,
): Promise<void> {
  if (clientRunning) return;
  abortConnect = false;
  clientRunning = true;
  onInboundMessage = messageHandler;
  activeClientConfig = config;
  try {
    await connectOnce(config, onConnect, onDisconnect);
  } catch (error) {
    if (config.client.reconnect.enabled && !abortConnect) {
      scheduleReconnect(config, onConnect, onDisconnect);
      return;
    }
    clientRunning = false;
    throw error;
  }
}

/** 幂等停止客户端、取消维护定时器并等待 Socket 关闭。 */
export async function stopWebSocketClient(): Promise<void> {
  abortConnect = true;
  clientRunning = false;
  onInboundMessage = null;
  activeClientConfig = null;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  const socket = clientSocket;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { socket.terminate(); resolve(); }, 1_000);
      timer.unref();
      socket.once("close", () => { clearTimeout(timer); resolve(); });
      socket.close(1001, "Client stopping");
    });
  }
  if (clientConnectionId) unregisterConnection(clientConnectionId);
  clientSocket = null;
  clientConnectionId = null;
  clientInfo = null;
  reconnectAttempt = 0;
  // Socket 关闭只会停止接收新帧；已进入 Agent 管道的任务仍需自然完成，避免热重载期间丢消息。
  await Promise.allSettled([...inboundTasks]);
}

export function getClientStats(): { running: boolean; connected: boolean; url: string | null; connectionId: string | null } {
  return { running: clientRunning, connected: clientSocket?.readyState === WebSocket.OPEN, url: activeClientConfig?.client.url ?? null, connectionId: clientConnectionId };
}

export function getClientConnectionInfo(): WebsocketConnectionInfo | null {
  return clientInfo ? { ...clientInfo } : null;
}
