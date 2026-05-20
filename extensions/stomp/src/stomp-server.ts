import * as fs from "node:fs";
import * as net from "node:net";
import * as tls from "node:tls";

import type {
  InboundHandler,
  InboundMessage,
  StompAckMode,
  StompConnection,
  StompFrame,
  StompStatusSnapshot,
  StompTcpConfig,
} from "./types.js";
import { parseMessageAny } from "@partme.ai/openclaw-message-sdk";

interface QueuedDelivery {
  destination: string;
  body: string;
}

interface PendingDelivery extends QueuedDelivery {
  ackId: string;
  subscriptionId: string;
}

interface ActiveSubscription {
  id: string;
  destination: string;
  ackMode: StompAckMode;
  prefetchCount: number;
  durable: boolean;
  autoDelete: boolean;
  pending: Map<string, PendingDelivery>;
  queue: QueuedDelivery[];
}

interface DurableSubscriptionState {
  key: string;
  destination: string;
  queue: QueuedDelivery[];
}

interface InternalConnection {
  id: string;
  remoteAddress: string;
  remotePort: number;
  version: string;
  user?: string;
  clientId?: string;
  connectedAt: string;
  subscriptionsById: Map<string, ActiveSubscription>;
}

const stats: StompStatusSnapshot = {
  totalConnections: 0,
  totalSubscriptions: 0,
  routedInbound: 0,
  routedOutbound: 0,
  droppedInbound: 0,
  ackPending: 0,
};

let tcpServer: net.Server | null = null;
let tlsServer: tls.Server | null = null;
let activeConfig: StompTcpConfig | null = null;
let connectionCounter = 0;
let outboundCounter = 0;

const connections = new Map<string, InternalConnection>();
const socketMap = new Map<string, net.Socket>();
const durableSubscriptions = new Map<string, DurableSubscriptionState>();

function parseFrame(data: string): StompFrame | null {
  const nullIdx = data.indexOf("\0");
  const frameData = nullIdx >= 0 ? data.slice(0, nullIdx) : data;
  const parts = frameData.split("\n\n");
  if (parts.length < 1) return null;
  const headerSection = parts[0];
  const body = parts.length > 1 ? parts.slice(1).join("\n\n") : "";
  const lines = headerSection.split("\n");
  const command = lines[0]?.trim();
  if (!command) return null;

  const headers: Record<string, string> = {};
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    headers[key] = value;
  }

  return { command, headers, body };
}

function buildFrame(command: string, headers: Record<string, string>, body = ""): string {
  let frame = `${command}\n`;
  for (const [key, value] of Object.entries(headers)) {
    frame += `${key}:${value}\n`;
  }
  if (body) frame += `content-length:${Buffer.byteLength(body)}\n`;
  frame += `\n${body}\0`;
  return frame;
}

function normalizeDestinationTopic(destination: string): string {
  if (destination.startsWith("/topic/")) return destination.slice("/topic/".length);
  if (destination.startsWith("/queue/")) return destination.slice("/queue/".length);
  if (destination.startsWith("/exchange/")) return destination.slice("/exchange/".length);
  return destination.replace(/^\/+/, "");
}

function matchTopic(pattern: string, destination: string): boolean {
  const p = normalizeDestinationTopic(pattern).split("/");
  const d = normalizeDestinationTopic(destination).split("/");
  let i = 0;
  let j = 0;
  while (i < p.length && j < d.length) {
    if (p[i] === "#") return true;
    if (p[i] === "*" || p[i] === d[j]) {
      i += 1;
      j += 1;
      continue;
    }
    return false;
  }
  if (i === p.length && j === d.length) return true;
  return i === p.length - 1 && p[i] === "#";
}

function queueAllowed(destination: string, cfg: StompTcpConfig): boolean {
  if (cfg.subscribeTopics.length === 0) return true;
  return cfg.subscribeTopics.some((pattern) => matchTopic(pattern, destination));
}

function resolveInboundRoute(destination: string, conn: InternalConnection, frame: StompFrame, cfg: StompTcpConfig): Omit<InboundMessage, "text"> {
  const peerId =
    frame.headers["x-peer-id"] ||
    frame.headers["peer-id"] ||
    frame.headers.sender ||
    conn.user ||
    conn.clientId ||
    conn.id;
  for (const binding of cfg.topicBindings) {
    if (matchTopic(binding.topicPattern, destination)) {
      return {
        agentId: binding.agentId,
        accountId: binding.accountId ?? "default",
        peerId,
        destination,
        replyDestination: binding.replyTopic,
      };
    }
  }

  const agentMatch = destination.match(/\/(?:queue\/)?agent[./]([^/]+)/);
  const agentId = agentMatch?.[1] ?? "default";
  return {
    agentId,
    accountId: "default",
    peerId,
    destination,
  };
}

function sendError(socket: net.Socket, message: string, receipt?: string): void {
  socket.write(
    buildFrame("ERROR", { message, ...(receipt ? { receipt } : {}) }, message),
  );
}

function flushSubscription(subscription: ActiveSubscription, connId: string): void {
  const socket = socketMap.get(connId);
  if (!socket || socket.destroyed) return;
  while (subscription.queue.length > 0) {
    const inflight = subscription.pending.size;
    if (subscription.ackMode !== "auto" && subscription.prefetchCount > 0 && inflight >= subscription.prefetchCount) {
      return;
    }
    const item = subscription.queue.shift();
    if (!item) return;
    outboundCounter += 1;
    const messageId = `msg-${Date.now()}-${outboundCounter}`;
    const ackId = `ack-${messageId}`;
    const headers: Record<string, string> = {
      destination: item.destination,
      "message-id": messageId,
      subscription: subscription.id,
      "content-type": "text/plain",
    };
    if (subscription.ackMode !== "auto") {
      headers.ack = ackId;
      subscription.pending.set(ackId, {
        ackId,
        subscriptionId: subscription.id,
        destination: item.destination,
        body: item.body,
      });
      stats.ackPending += 1;
    }
    socket.write(buildFrame("MESSAGE", headers, item.body));
    stats.routedOutbound += 1;
  }
}

function handleSubscribe(conn: InternalConnection, frame: StompFrame): void {
  if (!activeConfig) return;
  const destination = frame.headers.destination ?? "";
  if (!destination) return;
  const ackMode = (frame.headers.ack as StompAckMode | undefined) ?? activeConfig.defaultAckMode;
  const subscriptionId = frame.headers.id ?? `${destination}:${Date.now()}`;
  const durable = frame.headers.durable === "true" || frame.headers.persistent === "true";
  const autoDelete = frame.headers["auto-delete"] !== "false";
  const prefetchCount = Number(frame.headers["prefetch-count"] ?? activeConfig.prefetchCount);
  const subscription: ActiveSubscription = {
    id: subscriptionId,
    destination,
    ackMode,
    prefetchCount: Number.isFinite(prefetchCount) ? prefetchCount : activeConfig.prefetchCount,
    durable,
    autoDelete,
    pending: new Map<string, PendingDelivery>(),
    queue: [],
  };

  if (durable && !autoDelete) {
    const durableKey = `${conn.user ?? "anonymous"}:${subscriptionId}:${destination}`;
    const state = durableSubscriptions.get(durableKey);
    if (state) {
      subscription.queue.push(...state.queue);
      state.queue.length = 0;
    } else {
      durableSubscriptions.set(durableKey, {
        key: durableKey,
        destination,
        queue: [],
      });
    }
  }

  conn.subscriptionsById.set(subscriptionId, subscription);
  flushSubscription(subscription, conn.id);
}

function handleUnsubscribe(conn: InternalConnection, frame: StompFrame): void {
  const id = frame.headers.id ?? "";
  if (!id) return;
  const subscription = conn.subscriptionsById.get(id);
  if (!subscription) return;
  if (subscription.durable && !subscription.autoDelete) {
    const durableKey = `${conn.user ?? "anonymous"}:${id}:${subscription.destination}`;
    const existing = durableSubscriptions.get(durableKey);
    if (existing) existing.queue.push(...subscription.queue);
  }
  stats.ackPending = Math.max(0, stats.ackPending - subscription.pending.size);
  conn.subscriptionsById.delete(id);
}

function handleAckOrNack(conn: InternalConnection, frame: StompFrame, requeue: boolean): void {
  const ackId = frame.headers.id ?? frame.headers.ack;
  if (!ackId) return;

  for (const subscription of conn.subscriptionsById.values()) {
    const pending = subscription.pending.get(ackId);
    if (!pending) continue;
    subscription.pending.delete(ackId);
    stats.ackPending = Math.max(0, stats.ackPending - 1);
    if (requeue) {
      subscription.queue.unshift({
        destination: pending.destination,
        body: pending.body,
      });
    }
    flushSubscription(subscription, conn.id);
    return;
  }
}

function handleFrame(conn: InternalConnection, frame: StompFrame, onInbound: InboundHandler): void {
  const socket = socketMap.get(conn.id);
  if (!socket) return;

  switch (frame.command) {
    case "CONNECT":
    case "STOMP": {
      if (!activeConfig) return;
      const login = frame.headers.login;
      const passcode = frame.headers.passcode;
      if (activeConfig.auth.required) {
        const expectedUser = activeConfig.auth.defaultUser;
        const expectedPass = activeConfig.auth.defaultPass;
        if (expectedUser && expectedPass) {
          if (login !== expectedUser || passcode !== expectedPass) {
            sendError(socket, "Authentication failed");
            socket.end();
            return;
          }
        } else if (!login || !passcode) {
          sendError(socket, "login/passcode is required");
          socket.end();
          return;
        }
      }
      const acceptVersion = frame.headers["accept-version"] ?? "1.0";
      conn.version = acceptVersion.includes("1.2")
        ? "1.2"
        : acceptVersion.includes("1.1")
          ? "1.1"
          : "1.0";
      conn.user = login || activeConfig.auth.defaultUser || "anonymous";
      conn.clientId = frame.headers["client-id"];
      socket.write(
        buildFrame("CONNECTED", {
          version: conn.version,
          server: "openclaw-stomp/0.1.11",
          "heart-beat": `${activeConfig.heartbeat.serverMs},${activeConfig.heartbeat.clientMs}`,
        }),
      );
      return;
    }

    case "SEND": {
      if (!activeConfig) return;
      const destination = frame.headers.destination ?? "";
      if (!destination) {
        sendError(socket, "destination is required");
        return;
      }
      if (!queueAllowed(destination, activeConfig)) {
        stats.droppedInbound += 1;
        return;
      }
      const route = resolveInboundRoute(destination, conn, frame, activeConfig);

      // Try UnifiedMessage format first
      const rawBody = frame.body;
      const unifiedMsg = parseMessageAny(rawBody);
      const text = unifiedMsg?.text ?? rawBody;

      onInbound({ ...route, text });
      stats.routedInbound += 1;
      if (frame.headers.receipt) {
        socket.write(buildFrame("RECEIPT", { "receipt-id": frame.headers.receipt }));
      }
      return;
    }

    case "SUBSCRIBE":
      handleSubscribe(conn, frame);
      return;
    case "UNSUBSCRIBE":
      handleUnsubscribe(conn, frame);
      return;
    case "ACK":
      handleAckOrNack(conn, frame, false);
      return;
    case "NACK": {
      const requeue = frame.headers.requeue !== "false";
      handleAckOrNack(conn, frame, requeue);
      return;
    }
    case "DISCONNECT":
      if (frame.headers.receipt) {
        socket.write(buildFrame("RECEIPT", { "receipt-id": frame.headers.receipt }));
      }
      socket.end();
      return;
    default:
      sendError(socket, `Unknown STOMP command: ${frame.command}`);
  }
}

function handleConnection(socket: net.Socket, onInbound: InboundHandler): void {
  if (!activeConfig) return;
  const frameLimit = activeConfig.maxFrameSize;
  const connId = `stomp-tcp-${++connectionCounter}`;
  const conn: InternalConnection = {
    id: connId,
    remoteAddress: socket.remoteAddress ?? "unknown",
    remotePort: socket.remotePort ?? 0,
    version: "1.0",
    connectedAt: new Date().toISOString(),
    subscriptionsById: new Map(),
  };
  connections.set(connId, conn);
  socketMap.set(connId, socket);
  stats.totalConnections = connections.size;

  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf-8");
    if (buffer.length > frameLimit) {
      sendError(socket, `Frame exceeds maxFrameSize=${frameLimit}`);
      socket.end();
      return;
    }
    let nullIdx = buffer.indexOf("\0");
    while (nullIdx >= 0) {
      const rawFrame = buffer.slice(0, nullIdx + 1);
      buffer = buffer.slice(nullIdx + 1);
      const frame = parseFrame(rawFrame);
      if (frame) handleFrame(conn, frame, onInbound);
      nullIdx = buffer.indexOf("\0");
    }
  });

  socket.on("close", () => {
    for (const [subscriptionId, subscription] of conn.subscriptionsById.entries()) {
      if (subscription.durable && !subscription.autoDelete) {
        const durableKey = `${conn.user ?? "anonymous"}:${subscriptionId}:${subscription.destination}`;
        const state = durableSubscriptions.get(durableKey);
        if (state) state.queue.push(...subscription.queue);
      }
      stats.ackPending = Math.max(0, stats.ackPending - subscription.pending.size);
    }
    connections.delete(connId);
    socketMap.delete(connId);
    stats.totalConnections = connections.size;
  });

  socket.on("error", () => {
    connections.delete(connId);
    socketMap.delete(connId);
    stats.totalConnections = connections.size;
  });
}

export async function startStompTcpServer(config: StompTcpConfig, onInbound: InboundHandler): Promise<void> {
  activeConfig = config;

  tcpServer = net.createServer((socket) => handleConnection(socket, onInbound));
  tcpServer.maxConnections = config.maxConnections;

  await new Promise<void>((resolve, reject) => {
    tcpServer?.listen(config.port, () => resolve());
    tcpServer?.on("error", reject);
  });

  if (config.tls.enabled && config.tlsPort > 0 && config.tls.certFile && config.tls.keyFile) {
    const tlsOptions: tls.TlsOptions = {
      cert: fs.readFileSync(config.tls.certFile),
      key: fs.readFileSync(config.tls.keyFile),
    };
    if (config.tls.caFile) tlsOptions.ca = fs.readFileSync(config.tls.caFile);
    tlsServer = tls.createServer(tlsOptions, (socket) => handleConnection(socket, onInbound));
    await new Promise<void>((resolve, reject) => {
      tlsServer?.listen(config.tlsPort, () => resolve());
      tlsServer?.on("error", reject);
    });
  }
}

export async function stopStompTcpServer(): Promise<void> {
  for (const socket of socketMap.values()) {
    socket.destroy();
  }
  socketMap.clear();
  if (tcpServer) {
    await new Promise<void>((resolve) => tcpServer?.close(() => resolve()));
    tcpServer = null;
  }
  if (tlsServer) {
    await new Promise<void>((resolve) => tlsServer?.close(() => resolve()));
    tlsServer = null;
  }
  connections.clear();
  activeConfig = null;
  stats.totalConnections = 0;
  stats.totalSubscriptions = 0;
  stats.ackPending = 0;
}

export function getConnectionInfoList(): StompConnection[] {
  const result: StompConnection[] = [];
  for (const conn of connections.values()) {
    let inflight = 0;
    let queued = 0;
    const subscriptions: string[] = [];
    for (const subscription of conn.subscriptionsById.values()) {
      inflight += subscription.pending.size;
      queued += subscription.queue.length;
      subscriptions.push(subscription.destination);
    }
    result.push({
      id: conn.id,
      remoteAddress: conn.remoteAddress,
      remotePort: conn.remotePort,
      version: conn.version,
      user: conn.user,
      connectedAt: conn.connectedAt,
      subscriptions,
      inflightCount: inflight,
      queuedCount: queued,
    });
  }
  return result;
}

export function getConnectionStats(): { total: number; byVersion: Record<string, number> } {
  const byVersion: Record<string, number> = {};
  for (const conn of connections.values()) {
    byVersion[conn.version] = (byVersion[conn.version] ?? 0) + 1;
  }
  return {
    total: connections.size,
    byVersion,
  };
}

export function getStatusSnapshot(): StompStatusSnapshot {
  let totalSubscriptions = 0;
  for (const conn of connections.values()) {
    totalSubscriptions += conn.subscriptionsById.size;
  }
  stats.totalSubscriptions = totalSubscriptions;
  return { ...stats };
}

export function publishToDestination(destination: string, body: string): void {
  for (const [connId, conn] of connections.entries()) {
    for (const subscription of conn.subscriptionsById.values()) {
      if (subscription.destination !== destination) continue;
      subscription.queue.push({ destination, body });
      flushSubscription(subscription, connId);
    }
  }
}
