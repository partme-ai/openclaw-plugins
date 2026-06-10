/**
 * @module web-socket/transport/server
 *
 * 基于 `ws` 的嵌入式 WebSocket 服务端。
 */

import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

import type { WebsocketChannelConfig, WebsocketConnectionInfo } from "../types.js";
import {
  parseClientFrame,
  serializeConnectedFrame,
  serializeErrorFrame,
  serializePongFrame,
} from "../protocol.js";
import {
  getAllConnectionInfo,
  registerConnection,
  sendToConnection,
  unregisterConnection,
} from "./connection-hub.js";

/** 入站文本消息回调 */
export type WebsocketInboundCallback = (ctx: {
  connectionId: string;
  rawPayload: string;
  frameAgentId?: string;
  messageId?: string;
  peerId?: string;
}) => void;

let httpServer: ReturnType<typeof createServer> | null = null;
let wss: WebSocketServer | null = null;
let onInboundMessage: WebsocketInboundCallback | null = null;
let activeConfig: WebsocketChannelConfig | null = null;
let serverRunning = false;
const serverConnectionIds = new Set<string>();

/**
 * 从升级请求提取 Bearer / query token。
 */
function extractAuthToken(req: IncomingMessage): string | undefined {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const token = url.searchParams.get("token");
    return token?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * 校验入站连接 token（server.auth）。
 */
function verifyAuthToken(req: IncomingMessage, config: WebsocketChannelConfig): boolean {
  const auth = config.server.auth;
  if (!auth.enabled) {
    return true;
  }
  const allowed = new Set<string>();
  if (auth.token?.trim()) {
    allowed.add(auth.token.trim());
  }
  for (const t of auth.tokens) {
    if (t.trim()) {
      allowed.add(t.trim());
    }
  }
  if (allowed.size === 0) {
    return false;
  }
  const presented = extractAuthToken(req);
  return Boolean(presented && allowed.has(presented));
}

export { sendToConnection };

/**
 * 启动 WebSocket 服务端。
 */
export function startWebSocketServer(
  config: WebsocketChannelConfig,
  messageHandler: WebsocketInboundCallback,
  onConnect?: (connectionId: string) => void,
  onDisconnect?: (connectionId: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (serverRunning) {
      resolve();
      return;
    }
    onInboundMessage = messageHandler;
    activeConfig = config;
    const { server: serverCfg } = config;

    httpServer = createServer((_req, res) => {
      res.writeHead(426, { "Content-Type": "text/plain" });
      res.end("Upgrade Required");
    });

    wss = new WebSocketServer({
      server: httpServer,
      path: serverCfg.path,
      maxPayload: config.limits.maxPayloadBytes,
    });

    wss.on("connection", (ws, req) => {
      if (!verifyAuthToken(req, config)) {
        ws.close(4401, "Unauthorized");
        return;
      }
      if (serverConnectionIds.size >= serverCfg.maxConnections) {
        ws.send(serializeErrorFrame("Max connections reached"));
        ws.close(1013, "Try again later");
        return;
      }

      const connectionId = randomUUID();
      const remoteAddress = req.socket.remoteAddress;
      serverConnectionIds.add(connectionId);
      registerConnection(connectionId, ws, {
        connectedAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        remoteAddress,
      });

      ws.send(serializeConnectedFrame(connectionId));
      onConnect?.(connectionId);
      console.log(`[openclaw-web-socket] Server connection: ${connectionId}`);

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
          ws.send(serializeErrorFrame("Invalid message frame"));
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

      const cleanup = () => {
        serverConnectionIds.delete(connectionId);
        unregisterConnection(connectionId);
        onDisconnect?.(connectionId);
        console.log(`[openclaw-web-socket] Server disconnected: ${connectionId}`);
      };

      ws.on("close", cleanup);
      ws.on("error", (err) => {
        console.error(`[openclaw-web-socket] Server socket error ${connectionId}:`, err);
        cleanup();
      });
    });

    httpServer.on("error", (err) => {
      console.error("[openclaw-web-socket] HTTP server error:", err);
      reject(err);
    });

    httpServer.listen(serverCfg.wsPort, serverCfg.host, () => {
      serverRunning = true;
      console.log(
        `[openclaw-web-socket] Server listening ws://${serverCfg.host}:${serverCfg.wsPort}${serverCfg.path}`,
      );
      resolve();
    });
  });
}

/**
 * 停止 WebSocket 服务端。
 */
export async function stopWebSocketServer(): Promise<void> {
  for (const connectionId of serverConnectionIds) {
    sendToConnection(connectionId, serializeErrorFrame("Server shutting down"));
    unregisterConnection(connectionId);
  }
  serverConnectionIds.clear();
  onInboundMessage = null;
  activeConfig = null;
  serverRunning = false;

  await new Promise<void>((resolve) => {
    if (wss) {
      wss.close(() => resolve());
      wss = null;
    } else {
      resolve();
    }
  });

  await new Promise<void>((resolve) => {
    if (httpServer) {
      httpServer.close(() => resolve());
      httpServer = null;
    } else {
      resolve();
    }
  });
}

/**
 * 服务端运行状态。
 */
export function getServerStats(): {
  running: boolean;
  connectionCount: number;
  wsPort: number | null;
  path: string | null;
} {
  return {
    running: serverRunning,
    connectionCount: serverConnectionIds.size,
    wsPort: activeConfig?.server.wsPort ?? null,
    path: activeConfig?.server.path ?? null,
  };
}

/**
 * 服务端入站连接列表。
 */
export function getConnectedClients(): WebsocketConnectionInfo[] {
  return getAllConnectionInfo().filter((c) => serverConnectionIds.has(c.connectionId));
}
