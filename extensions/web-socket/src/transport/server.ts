/**
 * @fileoverview 带认证和有界资源控制的内嵌 WebSocket Server。
 *
 * Upgrade 阶段校验路径、Origin 和 Bearer/浏览器子协议 Token，连接建立后注册到共享 Hub，并以 Ping/Pong
 * 检测失活客户端。每条连接的入站消息串行处理，同时限制连接数、Payload、待处理消息、
 * 分钟速率和发送缓冲；关闭 Server 时释放所有连接、心跳和全局回调。
 */
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import { createServer as createSecureServer, type Server as HttpsServer } from "node:https";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";

import { parseClientFrame, serializeAcceptedFrame, serializeConnectedFrame, serializeErrorFrame, serializePongFrame } from "./protocol.js";
import type { WebsocketChannelConfig, WebsocketConnectionInfo } from "../types.js";
import {
  getAllConnectionInfo,
  registerConnection,
  sendToConnection,
  sendToConnectionConfirmed,
  touchConnection,
  unregisterConnection,
} from "./connection-hub.js";
import { redactWebSocketError } from "../shared/redact.js";

type WebSocketErrorLog = { error: (message: string) => void; warn?: (message: string) => void };

export type WebsocketInboundCallback = (ctx: {
  connectionId: string;
  rawPayload: string;
  frameAgentId?: string;
  messageId?: string;
  peerId?: string;
}) => Promise<void> | void;

const APPLICATION_SUBPROTOCOL = "openclaw.v1";
const AUTH_SUBPROTOCOL_PREFIX = "openclaw.auth.";

let httpServer: HttpServer | HttpsServer | null = null;
let wss: WebSocketServer | null = null;
let activeConfig: WebsocketChannelConfig | null = null;
let serverRunning = false;
let serverStarting = false;
let accepting = false;
let serverLog: WebSocketErrorLog | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
const serverConnections = new Map<string, WebSocket>();
const awaitingPong = new Map<string, number>();
/** stop 时必须等待的服务端 Agent 入站任务；连接断开不等于业务任务已经结束。 */
const inboundTasks = new Set<Promise<void>>();

function trackInboundTask(task: Promise<void>): Promise<void> {
  inboundTasks.add(task);
  void task.finally(() => inboundTasks.delete(task)).catch(() => undefined);
  return task;
}

function tokenDigest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function decodeProtocolToken(req: IncomingMessage): string | undefined {
  const header = req.headers["sec-websocket-protocol"];
  if (typeof header !== "string") return undefined;
  const encoded = header
    .split(",")
    .map((item) => item.trim())
    .find((item) => item.startsWith(AUTH_SUBPROTOCOL_PREFIX))
    ?.slice(AUTH_SUBPROTOCOL_PREFIX.length);
  if (!encoded) return undefined;
  try {
    return Buffer.from(encoded, "base64url").toString("utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

function extractAuthToken(req: IncomingMessage, config: WebsocketChannelConfig): string | undefined {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && /^bearer\s/i.test(auth)) return auth.replace(/^bearer\s+/i, "").trim();
  if (config.server.auth.allowProtocolToken) {
    const protocolToken = decodeProtocolToken(req);
    if (protocolToken) return protocolToken;
  }
  if (!config.server.auth.allowQueryToken) return undefined;
  try {
    return new URL(req.url ?? "/", "http://localhost").searchParams.get("token")?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function verifyAuthToken(req: IncomingMessage, config: WebsocketChannelConfig): boolean {
  const auth = config.server.auth;
  if (!auth.enabled) return true;
  const presented = extractAuthToken(req, config);
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
  return allowed.includes(origin);
}

export { sendToConnection };

async function createListener(config: WebsocketChannelConfig): Promise<HttpServer | HttpsServer> {
  const requestHandler = (_req: IncomingMessage, res: import("node:http").ServerResponse) => {
    res.writeHead(426, { "Content-Type": "text/plain", Connection: "close" });
    res.end("Upgrade Required");
  };
  if (!config.server.tls.enabled) return createServer(requestHandler);

  // 证书只在启动阶段读取一次；读取失败会阻止插件进入 running 状态，避免误以为 WSS 已生效。
  const [key, cert, ca] = await Promise.all([
    readFile(config.server.tls.keyFile!),
    readFile(config.server.tls.certFile!),
    config.server.tls.caFile ? readFile(config.server.tls.caFile) : Promise.resolve(undefined),
  ]);
  return createSecureServer({
    key,
    cert,
    ...(ca ? { ca } : {}),
    minVersion: config.server.tls.minVersion,
    requestCert: config.server.tls.requestCert,
    rejectUnauthorized: config.server.tls.rejectUnauthorized,
  }, requestHandler);
}

export async function startWebSocketServer(
  config: WebsocketChannelConfig,
  messageHandler: WebsocketInboundCallback,
  onConnect?: (connectionId: string) => void,
  onDisconnect?: (connectionId: string) => void,
  log?: WebSocketErrorLog,
): Promise<void> {
  if (serverRunning || serverStarting) throw new Error("WebSocket server is already running or starting");
  serverStarting = true;
  let nextHttpServer: HttpServer | HttpsServer;
  try {
    nextHttpServer = await createListener(config);
  } catch (error) {
    serverStarting = false;
    throw new Error(redactWebSocketError(error, config));
  }
  return new Promise((resolve, reject) => {
    activeConfig = config;
    serverLog = log;
    accepting = true;
    const serverCfg = config.server;
    const nextWss = new WebSocketServer({
      noServer: true,
      maxPayload: config.limits.maxPayloadBytes,
      // 认证子协议只负责携带浏览器 token，绝不能被服务端回显；应用层只协商固定版本协议。
      handleProtocols: (protocols) => protocols.has(APPLICATION_SUBPROTOCOL) ? APPLICATION_SUBPROTOCOL : false,
    });
    httpServer = nextHttpServer;
    wss = nextWss;

    nextHttpServer.on("upgrade", (req, socket, head) => {
      if (!accepting) return rejectUpgrade(socket, 503, "Service Unavailable");
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
        if (!accepting) {
          ws.close(1012, "Server restarting");
          return;
        }
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
        queue = trackInboundTask(queue
          .then(() => messageHandler({ connectionId, rawPayload: raw, frameAgentId: parsed.agentId, messageId: parsed.messageId, peerId: parsed.peerId }))
          .then(async () => {
            const delivered = await sendToConnectionConfirmed(
              connectionId,
              serializeAcceptedFrame(parsed.messageId),
              config.limits.maxBufferedBytes,
              config.limits.sendTimeoutMs,
            );
            if (!delivered) throw new Error("WebSocket accepted acknowledgement delivery failed");
          })
          .catch((error: unknown) => {
            log?.error(`[openclaw-web-socket] Inbound handler failed ${connectionId}: ${redactWebSocketError(error, config)}`);
            sendToConnection(connectionId, serializeErrorFrame("Message processing failed"), config.limits.maxBufferedBytes);
          })
          .finally(() => { pending -= 1; }));
      });
      ws.on("close", cleanup);
      ws.on("error", (error) => {
        log?.error(`[openclaw-web-socket] Server socket error ${connectionId}: ${redactWebSocketError(error, config)}`);
        cleanup();
      });
    });

    const onStartupError = (error: Error) => {
      activeConfig = null;
      serverLog = undefined;
      accepting = false;
      serverStarting = false;
      httpServer = null;
      wss = null;
      nextWss.close();
      reject(new Error(redactWebSocketError(error, config)));
    };
    nextHttpServer.once("error", onStartupError);
    nextHttpServer.listen(serverCfg.wsPort, serverCfg.host, () => {
      nextHttpServer.off("error", onStartupError);
      nextHttpServer.on("error", (error) => log?.error(`[openclaw-web-socket] HTTP server error: ${redactWebSocketError(error, config)}`));
      serverRunning = true;
      serverStarting = false;
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
  accepting = false;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  const config = activeConfig;
  const tasks = [...inboundTasks];
  if (tasks.length > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const drained = await Promise.race([
      Promise.allSettled(tasks).then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), config?.limits.shutdownTimeoutMs ?? 10_000);
        timer.unref();
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (!drained) {
      serverLog?.warn?.(
        `[openclaw-web-socket] shutdown drain timed out after ${config?.limits.shutdownTimeoutMs ?? 10_000}ms; ` +
        `${tasks.length} Agent task(s) may have an unknown outcome`,
      );
    }
  }
  // 排空期间保留 Hub 和 Socket，使已接纳消息仍能把 Agent reply/accepted 写回原连接。
  // 排空后使用有界 close handshake 冲刷最后的文本帧；立即 terminate 仍可能截断已进入内核前的 reply。
  const socketClosures = [...serverConnections.entries()].map(([connectionId, ws]) =>
    new Promise<void>((resolve) => {
      if (ws.readyState === WebSocket.CLOSED) {
        unregisterConnection(connectionId);
        resolve();
        return;
      }
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unregisterConnection(connectionId);
        resolve();
      };
      const timer = setTimeout(() => {
        ws.terminate();
        finish();
      }, Math.min(config?.limits.sendTimeoutMs ?? 1_000, 1_000));
      timer.unref();
      ws.once("close", finish);
      sendToConnection(connectionId, serializeErrorFrame("Server shutting down"));
      ws.close(1001, "Server shutting down");
    }),
  );
  await Promise.all(socketClosures);
  serverConnections.clear();
  awaitingPong.clear();
  const closingWss = wss;
  const closingHttp = httpServer;
  wss = null;
  httpServer = null;
  activeConfig = null;
  serverLog = undefined;
  serverRunning = false;
  serverStarting = false;
  await Promise.all([
    new Promise<void>((resolve) => closingWss ? closingWss.close(() => resolve()) : resolve()),
    new Promise<void>((resolve) => closingHttp ? closingHttp.close(() => resolve()) : resolve()),
  ]);
}

export function getServerStats(): { running: boolean; connectionCount: number; wsPort: number | null; path: string | null; secure: boolean } {
  return {
    running: serverRunning,
    connectionCount: serverConnections.size,
    wsPort: activeConfig?.server.wsPort ?? null,
    path: activeConfig?.server.path ?? null,
    secure: activeConfig?.server.tls.enabled ?? false,
  };
}

export function getConnectedClients(): WebsocketConnectionInfo[] {
  return getAllConnectionInfo().filter((item) => serverConnections.has(item.connectionId));
}
