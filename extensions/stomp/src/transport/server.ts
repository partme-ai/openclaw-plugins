/**
 * @fileoverview STOMP TCP 传输层：原生 TCP/TLS STOMP 帧解析、订阅、ACK 与 destination 路由。
 *
 * @description
 * 无第三方 Broker 依赖，Gateway 进程内嵌 STOMP Server；处理 CONNECT/SEND/SUBSCRIBE
 * 等命令，将 SEND 帧路由为 `InboundMessage` 并支持 prefetch/ACK/NACK 投递控制。
 *
 * @module transport/server
 */

/**
 * STOMP TCP 传输层 — 协议服务与出站 publish 入口。
 */

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
} from "../types.js";

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

/**
 * @description 从以 NUL 结尾的原始字符串解析单个 STOMP 帧。
 * @param data - 含可选 trailing `\0` 的帧字节串（UTF-8）。
 * @returns 解析后的 `StompFrame`，格式非法时 `null`。
 * @throws 不抛出。
 */
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

/**
 * @description 构造 STOMP 协议帧字符串（command + headers + body + NUL）。
 * @param command - STOMP 命令名（如 MESSAGE、CONNECTED）。
 * @param headers - 帧头键值对。
 * @param body - 可选消息体。
 * @returns 完整帧字符串（含 `\0` 终止符）。
 * @throws 不抛出。
 */
function buildFrame(command: string, headers: Record<string, string>, body = ""): string {
  let frame = `${command}\n`;
  for (const [key, value] of Object.entries(headers)) {
    frame += `${key}:${value}\n`;
  }
  if (body) frame += `content-length:${Buffer.byteLength(body)}\n`;
  frame += `\n${body}\0`;
  return frame;
}

/**
 * @description 将 STOMP destination 归一化为 topic 路径（去掉 /topic/ 等前缀）。
 * @param destination - 原始 destination 头。
 * @returns 用于通配符比较的 topic 段。
 * @throws 不抛出。
 */
function normalizeDestinationTopic(destination: string): string {
  if (destination.startsWith("/topic/")) return destination.slice("/topic/".length);
  if (destination.startsWith("/queue/")) return destination.slice("/queue/".length);
  if (destination.startsWith("/exchange/")) return destination.slice("/exchange/".length);
  return destination.replace(/^\/+/, "");
}

/**
 * @description STOMP/RabbitMQ 风格 destination 通配符匹配（`*` 单段、`#` 多级尾匹配）。
 * @param pattern - 订阅或 binding 模式。
 * @param destination - 实际 SEND destination。
 * @returns 是否匹配。
 * @throws 不抛出。
 */
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

/**
 * @description 判断 destination 是否落在 subscribeTopics 白名单内（空列表表示全放行）。
 * @param destination - SEND 目标 destination。
 * @param cfg - STOMP 服务配置。
 * @returns 是否允许入队/路由。
 * @throws 不抛出。
 */
function queueAllowed(destination: string, cfg: StompTcpConfig): boolean {
  if (cfg.subscribeTopics.length === 0) return true;
  return cfg.subscribeTopics.some((pattern) => matchTopic(pattern, destination));
}

/**
 * @description 将 SEND destination 解析为 Agent/account/peer 路由（topicBindings 优先）。
 * @param destination - STOMP destination 头。
 * @param conn - 当前连接上下文。
 * @param frame - 完整 SEND 帧（读取 x-peer-id 等扩展头）。
 * @param cfg - STOMP 服务配置。
 * @returns 不含 rawPayload 的入站路由字段。
 * @throws 不抛出。
 */
function resolveInboundRoute(
  destination: string,
  conn: InternalConnection,
  frame: StompFrame,
  cfg: StompTcpConfig,
): Omit<InboundMessage, "rawPayload" | "idempotencyKey"> {
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

/**
 * @description 向客户端写入 STOMP ERROR 帧并可携带 receipt-id。
 * @param socket - 客户端 TCP socket。
 * @param message - 错误描述。
 * @param receipt - 可选 receipt 头回显。
 * @returns void
 * @throws 不抛出。
 */
function sendError(socket: net.Socket, message: string, receipt?: string): void {
  socket.write(
    buildFrame("ERROR", { message, ...(receipt ? { receipt } : {}) }, message),
  );
}

/**
 * @description 按 prefetch 限制从订阅队列向客户端 flush MESSAGE 帧。
 * @param subscription - 活跃订阅状态（含 pending ACK 与 queue）。
 * @param connId - 连接 ID（查 socketMap）。
 * @returns void
 * @throws 不抛出。
 */
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

/**
 * @description 处理 SUBSCRIBE 帧：注册订阅、恢复 durable 队列并 flush。
 * @param conn - 当前连接。
 * @param frame - SUBSCRIBE 帧。
 * @returns void
 * @throws 不抛出。
 */
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

/**
 * @description 处理 UNSUBSCRIBE 帧：迁移 durable 队列并移除订阅。
 * @param conn - 当前连接。
 * @param frame - UNSUBSCRIBE 帧。
 * @returns void
 * @throws 不抛出。
 */
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

/**
 * @description 处理 ACK/NACK：确认或 requeue pending MESSAGE。
 * @param conn - 当前连接。
 * @param frame - ACK 或 NACK 帧。
 * @param requeue - NACK 时是否 requeue（ACK 时为 false）。
 * @returns void
 * @throws 不抛出。
 */
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

/**
 * @description STOMP 命令分发器：CONNECT/SEND/SUBSCRIBE/ACK 等帧处理入口。
 * @param conn - 当前连接状态。
 * @param frame - 已解析 STOMP 帧。
 * @param onInbound - SEND 路由后的入站回调。
 * @returns void
 * @throws 不抛出；未知命令写 ERROR 帧。
 */
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
      const rawBody = frame.body ?? "";
      const idempotencyKey =
        frame.headers["message-id"] ||
        frame.headers.receipt ||
        `${conn.id}:${destination}:${rawBody.slice(0, 64)}:${Buffer.byteLength(rawBody, "utf-8")}`;

      onInbound({ ...route, rawPayload: rawBody, idempotencyKey });
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

/**
 * @description 新 TCP 连接生命周期：缓冲分帧、parseFrame → handleFrame、close 清理。
 * @param socket - 客户端 socket。
 * @param onInbound - SEND 入站回调。
 * @returns void
 * @throws 不抛出。
 */
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

/**
 * @description 启动 STOMP TCP（及可选 TLS）监听，注册入站 SEND 帧回调。
 * @param config - STOMP 服务配置
 * @param onInbound - 入站消息处理器（通常为 dispatchInboundMessage）
 */
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

/** @description 停止 STOMP 服务并销毁所有连接。 */
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

/** @description 列出当前活跃 STOMP 连接及订阅摘要。 */
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

/** @description 按 STOMP 协议版本聚合连接数统计。 */
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

/** @description 返回路由/连接运行时统计快照。 */
export function getStatusSnapshot(): StompStatusSnapshot {
  let totalSubscriptions = 0;
  for (const conn of connections.values()) {
    totalSubscriptions += conn.subscriptionsById.size;
  }
  stats.totalSubscriptions = totalSubscriptions;
  return { ...stats };
}

/**
 * @description 向已订阅指定 destination 的客户端推送 MESSAGE 帧（出站/Agent 回复）。
 * @param destination - STOMP destination（如 /topic/session.xxx）
 * @param body - 消息体
 */
export function publishToDestination(destination: string, body: string): void {
  for (const [connId, conn] of connections.entries()) {
    for (const subscription of conn.subscriptionsById.values()) {
      if (subscription.destination !== destination) continue;
      subscription.queue.push({ destination, body });
      flushSubscription(subscription, connId);
    }
  }
}
