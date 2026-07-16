/**
 * @fileoverview 带认证和有界资源控制的内嵌 WebSocket Server。
 *
 * Upgrade 阶段校验路径、Origin 和 Bearer Token，连接建立后注册到共享 Hub，并以 Ping/Pong
 * 检测失活客户端。每条连接的入站消息串行处理，同时限制连接数、Payload、待处理消息、
 * 分钟速率和发送缓冲；关闭 Server 时释放所有连接、心跳和全局回调。
 */
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";

import { parseClientFrame, serializeConnectedFrame, serializeErrorFrame, serializePongFrame } from "./protocol.js";
import type { WebsocketChannelConfig, WebsocketConnectionInfo } from "../types.js";
import {
  getAllConnectionInfo,
  registerConnection,
  sendToConnection,
  touchConnection,
  unregisterConnection,
} from "./connection-hub.js";

export type WebsocketInboundCallback = (ctx: {
  connectionId: string;
  rawPayload: string;
  frameAgentId?: string;
  messageId?: string;
  peerId?: string;
}) => Promise<void> | void;

let httpServer: ReturnType<typeof createServer> | null = null;
let wss: WebSocketServer | null = null;
let activeConfig: WebsocketChannelConfig | null = null;
let serverRunning = false;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
const serverConnections = new Map<string, WebSocket>();
const awaitingPong = new Map<string, number>();

function tokenDigest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function extractAuthToken(req: IncomingMessage, allowQueryToken: boolean): string | undefined {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && /^bearer\s/i.test(auth)) return auth.replace(/^bearer\s+/i, "").trim();
  if (!allowQueryToken) return undefined;
  try {
    return new URL(req.url ?? "/", "http://localhost").searchParams.get("token")?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function verifyAuthToken(req: IncomingMessage, config: WebsocketChannelConfig): boolean {
  const auth = config.server.auth;
  if (!auth.enabled) return true;
  const presented = extractAuthToken(req, auth.allowQueryToken);
  if (!presented) return false;
  const actual = tokenDigest(presented);
  return auth.tokens.some((token) => timingSafeEqual(actual, tokenDigest(token)));
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  if (socket.destroyed) return;
  socket.write(
    `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`,
  );
  socket.destroy();
}

function isOriginAllowed(req: IncomingMessage, config: WebsocketChannelConfig): boolean {
  const allowed = config.server.allowedOrigins;
  if (allowed.length === 0) return true;
  const origin = req.headers.origin;
  if (typeof origin !== "string") return true;
  return allowed.includes("*") || allowed.includes(origin);
}

export { sendToConnection };

export function startWebSocketServer(
  config: WebsocketChannelConfig,
  messageHandler: WebsocketInboundCallback,
  onConnect?: (connectionId: string) => void,
  onDisconnect?: (connectionId: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (serverRunning) return resolve();
    activeConfig = config;
    const serverCfg = config.server;
    const nextHttpServer = createServer((_req, res) => {
      res.writeHead(426, { "Content-Type": "text/plain", Connection: "close" });
      res.end("Upgrade Required");
    });
    const nextWss = new WebSocketServer({ noServer: true, maxPayload: config.limits.maxPayloadBytes });
    httpServer = nextHttpServer;
    wss = nextWss;

    nextHttpServer.on("upgrade", (req, socket, head) => {
      let pathname = "";
      try { pathname = new URL(req.url ?? "/", "http://localhost").pathname; } catch { /* rejected below */ }
      if (pathname !== serverCfg.path) return rejectUpgrade(socket, 404, "Not Found");
      if (!isOriginAllowed(req, config)) return rejectUpgrade(socket, 403, "Forbidden");
      if (!verifyAuthToken(req, config)) return rejectUpgrade(socket, 401, "Unauthorized");
      if (serverConnections.size >= serverCfg.maxConnections) return rejectUpgrade(socket, 503, "Service Unavailable");
      nextWss.handleUpgrade(req, socket, head, (ws) => nextWss.emit("connection", ws, req));
    });

    nextWss.on("connection", (ws, req) => {
      const connectionId = randomUUID();
      let cleaned = false;
      let pending = 0;
      let queue = Promise.resolve();
      let windowStart = Date.now();
      let windowMessages = 0;
      serverConnections.set(connectionId, ws);
      registerConnection(connectionId, ws, {
        connectedAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        remoteAddress: req.socket.remoteAddress,
      });
      sendToConnection(connectionId, serializeConnectedFrame(connectionId), config.limits.maxBufferedBytes);
      onConnect?.(connectionId);

      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        awaitingPong.delete(connectionId);
        serverConnections.delete(connectionId);
        unregisterConnection(connectionId);
        onDisconnect?.(connectionId);
      };

      ws.on("pong", () => {
        awaitingPong.delete(connectionId);
        touchConnection(connectionId);
      });
      ws.on("message", (data, isBinary) => {
        touchConnection(connectionId);
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
        queue = queue
          .then(() => messageHandler({ connectionId, rawPayload: raw, frameAgentId: parsed.agentId, messageId: parsed.messageId, peerId: parsed.peerId }))
          .catch((error: unknown) => {
            console.error(`[openclaw-web-socket] Inbound handler failed ${connectionId}:`, error);
            sendToConnection(connectionId, serializeErrorFrame("Message processing failed"), config.limits.maxBufferedBytes);
          })
          .finally(() => { pending -= 1; });
      });
      ws.on("close", cleanup);
      ws.on("error", (error) => {
        console.error(`[openclaw-web-socket] Server socket error ${connectionId}:`, error);
        cleanup();
      });
    });

    const onStartupError = (error: Error) => {
      activeConfig = null;
      httpServer = null;
      wss = null;
      nextWss.close();
      reject(error);
    };
    nextHttpServer.once("error", onStartupError);
    nextHttpServer.listen(serverCfg.wsPort, serverCfg.host, () => {
      nextHttpServer.off("error", onStartupError);
      nextHttpServer.on("error", (error) => console.error("[openclaw-web-socket] HTTP server error:", error));
      serverRunning = true;
      heartbeatTimer = setInterval(() => {
        const now = Date.now();
        for (const [connectionId, ws] of serverConnections) {
          const sentAt = awaitingPong.get(connectionId);
          if (sentAt && now - sentAt > config.limits.heartbeatTimeoutMs) {
            ws.terminate();
            continue;
          }
          if (ws.readyState === WebSocket.OPEN && !sentAt) {
            awaitingPong.set(connectionId, now);
            ws.ping();
          }
        }
      }, config.limits.heartbeatIntervalMs);
      heartbeatTimer.unref();
      resolve();
    });
  });
}

export async function stopWebSocketServer(): Promise<void> {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  for (const [connectionId, ws] of serverConnections) {
    sendToConnection(connectionId, serializeErrorFrame("Server shutting down"));
    ws.terminate();
    unregisterConnection(connectionId);
  }
  serverConnections.clear();
  awaitingPong.clear();
  const closingWss = wss;
  const closingHttp = httpServer;
  wss = null;
  httpServer = null;
  activeConfig = null;
  serverRunning = false;
  await new Promise<void>((resolve) => closingWss ? closingWss.close(() => resolve()) : resolve());
  await new Promise<void>((resolve) => closingHttp ? closingHttp.close(() => resolve()) : resolve());
}

export function getServerStats(): { running: boolean; connectionCount: number; wsPort: number | null; path: string | null } {
  return { running: serverRunning, connectionCount: serverConnections.size, wsPort: activeConfig?.server.wsPort ?? null, path: activeConfig?.server.path ?? null };
}

export function getConnectedClients(): WebsocketConnectionInfo[] {
  return getAllConnectionInfo().filter((item) => serverConnections.has(item.connectionId));
}
