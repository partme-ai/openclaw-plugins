/**
 * @fileoverview 加固的 STOMP 1.2 over WebSocket/WSS 协议服务器。
 *
 * 实现 CONNECT、SEND、SUBSCRIBE、ACK/NACK 与心跳协商，Upgrade 阶段校验路径、Origin 和
 * 连接容量。每个连接的帧串行处理，并受帧大小、待处理队列、订阅数、pending ACK、速率和
 * WebSocket backpressure 限制；默认订阅仅允许当前 session Topic，跨会话共享必须显式启用。
 */
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import { createServer as createSecureServer, type Server as HttpsServer } from "node:https";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";

import { assertValidStompWsConfig } from "../config.js";
import { isSendable, isSubscribable, parseDestination } from "../routing/destination-router.js";
import type { StompConnectionInfo, StompFrame, StompServerConfig } from "../types.js";
import { redactWebStompError } from "../shared/redact.js";
import {
  cleanupConnection,
  clearAckState,
  discardPendingMessage,
  getPendingAckCount,
  handleAck,
  handleNack,
  registerMessage,
} from "./ack-handler.js";
import {
  buildConnectedFrame,
  buildErrorFrame,
  buildMessageFrame,
  buildReceiptFrame,
  extractCompleteFrames,
  parseFrame,
  serializeFrame,
} from "./frame-parser.js";
import {
  addSubscription,
  clearSubscriptions,
  getConnectionSubscriptions,
  getSubscribers,
  hasSubscription,
  removeAllSubscriptions,
  removeSubscription,
} from "./subscription-mgr.js";

export type StompInboundCallback = (ctx: {
  agentId: string;
  peerId: string;
  destination: string;
  rawPayload: string;
  idempotencyKey?: string;
}) => Promise<void> | void;

type ConnectionState = {
  ws: WebSocket;
  info: StompConnectionInfo;
  connected: boolean;
  cleaned: boolean;
  buffer: string;
  queue: Promise<void>;
  pending: number;
  windowStartedAt: number;
  windowMessages: number;
  lastInboundAt: number;
  lastOutboundAt: number;
  incomingHeartbeatMs: number;
  outgoingHeartbeatMs: number;
  connectTimer: ReturnType<typeof setTimeout>;
};

let listener: HttpServer | HttpsServer | null = null;
let wss: WebSocketServer | null = null;
let activeConfig: StompServerConfig | null = null;
let onInboundMessage: StompInboundCallback | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let running = false;
let accepting = false;
type TransportLogger = { error(message: string): void; warn?(message: string): void; info?(message: string): void };
const NOOP_LOGGER: TransportLogger = { error: () => undefined };
let transportLogger: TransportLogger = NOOP_LOGGER;
const states = new Map<string, ConnectionState>();
const stats = {
  rejectedConnections: 0,
  authFailures: 0,
  protocolErrors: 0,
  droppedInbound: 0,
  droppedOutbound: 0,
};

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  if (socket.destroyed) return;
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`);
  socket.destroy();
}

function originAllowed(req: IncomingMessage, config: StompServerConfig): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || config.allowedOrigins.length === 0) return true;
  try {
    const parsed = new URL(origin);
    return parsed.origin === origin && config.allowedOrigins.includes(parsed.origin);
  } catch {
    return false;
  }
}

function secureEqual(left: string, right: string): boolean {
  const a = createHash("sha256").update(left, "utf8").digest();
  const b = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(a, b);
}

function authenticate(login: string | undefined, passcode: string | undefined, config: StompServerConfig): boolean {
  if (!config.auth.required) return true;
  if (!login || passcode === undefined) return false;
  const user = config.auth.users.find((candidate) => secureEqual(candidate.login, login));
  if (!user) return false;
  const plain = user.passwordEnv ? process.env[user.passwordEnv] : user.password;
  if (plain !== undefined) return secureEqual(plain, passcode);
  if (!user.passwordHash) return false;
  const digest = createHash(user.hashAlgorithm ?? "sha256").update(passcode, "utf8").digest("hex");
  return secureEqual(user.passwordHash.toLowerCase(), digest.toLowerCase());
}

function parseHeartBeat(value: string | undefined): [number, number] {
  if (!value) return [0, 0];
  const match = /^(\d+),(\d+)$/.exec(value.trim());
  if (!match) throw new Error("Invalid heart-beat header");
  return [Math.min(Number(match[1]), 300_000), Math.min(Number(match[2]), 300_000)];
}

function sendRaw(connectionId: string, payload: string): boolean {
  const state = states.get(connectionId);
  const config = activeConfig;
  if (!state || !config || state.ws.readyState !== WebSocket.OPEN) return false;
  if (state.ws.bufferedAmount + Buffer.byteLength(payload, "utf8") > config.maxBufferedBytes) {
    state.ws.close(1013, "Outbound backpressure limit exceeded");
    return false;
  }
  state.ws.send(payload, (error) => { if (error) state.ws.terminate(); });
  state.lastOutboundAt = Date.now();
  state.info.lastActiveAt = new Date().toISOString();
  return true;
}

function sendFrame(connectionId: string, frame: StompFrame): boolean {
  return sendRaw(connectionId, serializeFrame(frame));
}

/** 等待 `ws.send` 回调，只有数据真正交给底层套接字后才报告投递成功。 */
async function sendFrameConfirmed(connectionId: string, frame: StompFrame): Promise<boolean> {
  const state = states.get(connectionId);
  const config = activeConfig;
  if (!state || !config || state.ws.readyState !== WebSocket.OPEN) return false;
  const payload = serializeFrame(frame);
  if (state.ws.bufferedAmount + Buffer.byteLength(payload, "utf8") > config.maxBufferedBytes) {
    state.ws.close(1013, "Outbound backpressure limit exceeded");
    return false;
  }
  return new Promise<boolean>((resolve) => {
    try {
      state.ws.send(payload, (error) => {
        if (error) {
          state.ws.terminate();
          resolve(false);
          return;
        }
        state.lastOutboundAt = Date.now();
        state.info.lastActiveAt = new Date().toISOString();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

function failProtocol(connectionId: string, message: string, receiptId?: string, close = false): void {
  stats.protocolErrors += 1;
  sendFrame(connectionId, buildErrorFrame(message, receiptId));
  if (close) states.get(connectionId)?.ws.close(1002, message.slice(0, 120));
}

function cleanup(connectionId: string): void {
  const state = states.get(connectionId);
  if (!state || state.cleaned) return;
  state.cleaned = true;
  clearTimeout(state.connectTimer);
  removeAllSubscriptions(connectionId);
  cleanupConnection(connectionId);
  states.delete(connectionId);
}

function ownSessionDestination(connectionId: string, destination: string): boolean {
  const route = parseDestination(destination);
  return route?.target === "session" && route.sessionKey?.startsWith(`stomp:${connectionId}@`) === true;
}

function allowedAgent(agentId: string, config: StompServerConfig): boolean {
  return agentId === config.defaultAgentId || config.allowedAgentIds.includes(agentId);
}

async function handleConnect(connectionId: string, frame: StompFrame, config: StompServerConfig): Promise<void> {
  const state = states.get(connectionId);
  if (!state) return;
  if (state.connected) {
    failProtocol(connectionId, "STOMP session is already connected", frame.headers.receipt, true);
    return;
  }
  const versions = (frame.headers["accept-version"] ?? "").split(",").map((item) => item.trim());
  if (!versions.includes("1.2")) {
    failProtocol(connectionId, "Only STOMP 1.2 is supported", frame.headers.receipt, true);
    return;
  }
  const login = frame.headers.login;
  if (!authenticate(login, frame.headers.passcode, config)) {
    stats.authFailures += 1;
    failProtocol(connectionId, "Authentication failed", frame.headers.receipt, true);
    return;
  }
  let clientOutgoing: number;
  let clientIncoming: number;
  try {
    [clientOutgoing, clientIncoming] = parseHeartBeat(frame.headers["heart-beat"]);
  } catch (error) {
    failProtocol(connectionId, String((error as Error).message), frame.headers.receipt, true);
    return;
  }
  state.incomingHeartbeatMs = clientOutgoing > 0 && config.heartbeatIncoming > 0
    ? Math.max(clientOutgoing, config.heartbeatIncoming)
    : 0;
  state.outgoingHeartbeatMs = clientIncoming > 0 && config.heartbeatOutgoing > 0
    ? Math.max(clientIncoming, config.heartbeatOutgoing)
    : 0;
  state.connected = true;
  state.info.stompConnected = true;
  state.info.login = login;
  clearTimeout(state.connectTimer);
  sendFrame(connectionId, buildConnectedFrame(`${config.heartbeatOutgoing},${config.heartbeatIncoming}`, connectionId));
}

async function handleSend(connectionId: string, frame: StompFrame, config: StompServerConfig): Promise<void> {
  const destination = frame.headers.destination;
  if (!destination || !isSendable(destination)) throw new Error("SEND requires a valid queue destination");
  const route = parseDestination(destination);
  if (!route || route.target !== "agent") throw new Error("SEND destination must target an Agent");
  const agentId = route.agentId ?? config.defaultAgentId;
  if (!allowedAgent(agentId, config)) throw new Error(`Agent is not allowed: ${agentId}`);
  const peerId = `stomp:${connectionId}@${agentId}`;
  const body = frame.body ?? "";
  const state = states.get(connectionId);
  if (state) {
    state.info.agentId = agentId;
    state.info.peerId = peerId;
  }
  if (!onInboundMessage) throw new Error("Web STOMP inbound handler is not initialized");
  try {
    await onInboundMessage({
      agentId,
      peerId,
      destination,
      rawPayload: body,
      idempotencyKey: frame.headers["message-id"] || frame.headers.receipt || createHash("sha256").update(`${connectionId}\0${destination}\0${body}`).digest("hex"),
    });
  } catch (error) {
    // 内部 Runtime 错误只写脱敏日志；外部 STOMP 客户端不能获得堆栈、凭据或基础设施地址。
    transportLogger.error(`[openclaw-web-stomp] Agent dispatch failed connection=${connectionId}: ${redactWebStompError(error)}`);
    throw new Error("Agent dispatch failed");
  }
}

function handleSubscribe(connectionId: string, frame: StompFrame, config: StompServerConfig): void {
  const id = frame.headers.id;
  const destination = frame.headers.destination;
  const ack = frame.headers.ack ?? "auto";
  if (!id || !destination || !isSubscribable(destination)) throw new Error("SUBSCRIBE requires id and a valid topic destination");
  if (ack !== "auto" && ack !== "client" && ack !== "client-individual") throw new Error("Invalid SUBSCRIBE ack mode");
  if (!config.allowSharedTopics && !ownSessionDestination(connectionId, destination)) {
    throw new Error("Subscription is outside this connection's session scope");
  }
  if (getConnectionSubscriptions(connectionId).length >= config.maxSubscriptionsPerConnection) {
    throw new Error("Subscription limit exceeded");
  }
  if (!addSubscription(connectionId, { id, destination, ack })) throw new Error(`Duplicate subscription id: ${id}`);
  const state = states.get(connectionId);
  if (state) state.info.subscriptionCount += 1;
}

function handleUnsubscribe(connectionId: string, frame: StompFrame): void {
  const id = frame.headers.id;
  if (!id || !hasSubscription(connectionId, id)) throw new Error("Unknown subscription id");
  removeSubscription(connectionId, id);
  const state = states.get(connectionId);
  if (state) state.info.subscriptionCount = Math.max(0, state.info.subscriptionCount - 1);
}

async function handleFrame(connectionId: string, frame: StompFrame, config: StompServerConfig): Promise<void> {
  const state = states.get(connectionId);
  if (!state) return;
  const receiptId = frame.headers.receipt;
  if (!state.connected && frame.command !== "CONNECT" && frame.command !== "STOMP") {
    failProtocol(connectionId, "CONNECT is required before other commands", receiptId, true);
    return;
  }
  try {
    switch (frame.command) {
      case "CONNECT":
      case "STOMP":
        await handleConnect(connectionId, frame, config);
        return;
      case "SEND":
        await handleSend(connectionId, frame, config);
        break;
      case "SUBSCRIBE":
        handleSubscribe(connectionId, frame, config);
        break;
      case "UNSUBSCRIBE":
        handleUnsubscribe(connectionId, frame);
        break;
      case "ACK": {
        const id = frame.headers.id ?? frame.headers.ack ?? "";
        if (handleAck(id, connectionId) === 0) throw new Error("Unknown ACK id");
        break;
      }
      case "NACK": {
        const id = frame.headers.id ?? frame.headers.ack ?? "";
        if (!handleNack(id, connectionId)) throw new Error("Unknown NACK id");
        break;
      }
      case "DISCONNECT":
        if (receiptId) sendFrame(connectionId, buildReceiptFrame(receiptId));
        state.ws.close(1000, "STOMP disconnect");
        return;
      default:
        throw new Error(`Unsupported command: ${frame.command}`);
    }
    if (receiptId) sendFrame(connectionId, buildReceiptFrame(receiptId));
  } catch (error) {
    failProtocol(connectionId, error instanceof Error ? error.message : String(error), receiptId);
  }
}

function enqueueFrame(connectionId: string, frame: StompFrame, config: StompServerConfig): void {
  const state = states.get(connectionId);
  if (!state) return;
  if (!accepting) {
    state.ws.close(1012, "Server restarting");
    return;
  }
  const now = Date.now();
  if (now - state.windowStartedAt >= 60_000) {
    state.windowStartedAt = now;
    state.windowMessages = 0;
  }
  if (++state.windowMessages > config.messagesPerMinute) {
    stats.droppedInbound += 1;
    state.ws.close(1008, "Message rate limit exceeded");
    return;
  }
  if (state.pending >= config.maxPendingMessages) {
    stats.droppedInbound += 1;
    state.ws.close(1013, "Inbound queue full");
    return;
  }
  state.pending += 1;
  state.queue = state.queue
    .then(() => handleFrame(connectionId, frame, config))
    .catch((error: unknown) => {
      transportLogger.error(`[openclaw-web-stomp] frame processing failed connection=${connectionId}: ${redactWebStompError(error)}`);
      failProtocol(connectionId, "Frame processing failed");
    })
    .finally(() => { state.pending -= 1; });
}

function attachConnection(ws: WebSocket, req: IncomingMessage, config: StompServerConfig): void {
  const connectionId = randomUUID();
  const now = Date.now();
  const state: ConnectionState = {
    ws,
    info: {
      connectionId,
      connectedAt: new Date(now).toISOString(),
      lastActiveAt: new Date(now).toISOString(),
      subscriptionCount: 0,
      stompConnected: false,
      remoteAddress: req.socket.remoteAddress,
    },
    connected: false,
    cleaned: false,
    buffer: "",
    queue: Promise.resolve(),
    pending: 0,
    windowStartedAt: now,
    windowMessages: 0,
    lastInboundAt: now,
    lastOutboundAt: now,
    incomingHeartbeatMs: 0,
    outgoingHeartbeatMs: 0,
    connectTimer: setTimeout(() => {
      failProtocol(connectionId, "STOMP CONNECT timeout", undefined, true);
    }, config.connectTimeoutMs),
  };
  state.connectTimer.unref();
  states.set(connectionId, state);

  ws.on("message", (data, isBinary) => {
    state.lastInboundAt = Date.now();
    state.info.lastActiveAt = new Date().toISOString();
    if (isBinary) {
      ws.close(1003, "Binary STOMP frames are not supported");
      return;
    }
    state.buffer += data.toString("utf8");
    const extracted = extractCompleteFrames(state.buffer);
    state.buffer = extracted.rest;
    for (const raw of extracted.frames) {
      if (Buffer.byteLength(raw, "utf8") > config.maxFrameSize) {
        ws.close(1009, "STOMP frame too large");
        return;
      }
      const frame = parseFrame(raw);
      if (!frame) {
        failProtocol(connectionId, "Malformed STOMP frame", undefined, true);
        return;
      }
      else enqueueFrame(connectionId, frame, config);
    }
    if (Buffer.byteLength(state.buffer, "utf8") > config.maxFrameSize) {
      ws.close(1009, "STOMP frame too large");
    }
  });
  ws.on("close", () => cleanup(connectionId));
  ws.on("error", (error) => {
    transportLogger.error(`[openclaw-web-stomp] WebSocket error connection=${connectionId}: ${redactWebStompError(error)}`);
    cleanup(connectionId);
  });
}

async function createListener(config: StompServerConfig): Promise<HttpServer | HttpsServer> {
  const handler = (_req: IncomingMessage, res: import("node:http").ServerResponse) => {
    res.writeHead(426, { "Content-Type": "text/plain", Connection: "close" });
    res.end("Upgrade Required");
  };
  if (!config.tls.enabled) return createServer(handler);
  const [key, cert, ca] = await Promise.all([
    readFile(config.tls.keyFile!),
    readFile(config.tls.certFile!),
    config.tls.caFile ? readFile(config.tls.caFile) : Promise.resolve(undefined),
  ]);
  return createSecureServer({
    key,
    cert,
    ca,
    minVersion: config.tls.minVersion,
    requestCert: config.tls.requestCert,
    rejectUnauthorized: config.tls.rejectUnauthorized,
  }, handler);
}

export async function startStompServer(
  config: StompServerConfig,
  messageHandler: StompInboundCallback,
  logger: TransportLogger = NOOP_LOGGER,
): Promise<void> {
  if (running) return;
  assertValidStompWsConfig(config);
  const nextListener = await createListener(config);
  const nextWss = new WebSocketServer({ noServer: true, maxPayload: config.maxFrameSize, perMessageDeflate: false });
  listener = nextListener;
  wss = nextWss;
  activeConfig = config;
  onInboundMessage = messageHandler;
  transportLogger = logger;
  accepting = true;
  Object.keys(stats).forEach((key) => { stats[key as keyof typeof stats] = 0; });

  nextListener.on("upgrade", (req, socket, head) => {
    let path = "";
    try { path = new URL(req.url ?? "/", "http://localhost").pathname; } catch { /* rejected below */ }
    if (path !== config.path) {
      stats.rejectedConnections += 1;
      return rejectUpgrade(socket, 404, "Not Found");
    }
    if (!originAllowed(req, config)) {
      stats.rejectedConnections += 1;
      return rejectUpgrade(socket, 403, "Forbidden");
    }
    if (states.size >= config.maxConnections) {
      stats.rejectedConnections += 1;
      return rejectUpgrade(socket, 503, "Service Unavailable");
    }
    nextWss.handleUpgrade(req, socket, head, (ws) => nextWss.emit("connection", ws, req));
  });
  nextWss.on("connection", (ws, req) => attachConnection(ws, req, config));

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    nextListener.once("error", onError);
    nextListener.listen(config.wsPort, config.host, () => {
      nextListener.off("error", onError);
      nextListener.on("error", (error) => {
        transportLogger.error(`[openclaw-web-stomp] Listener error: ${redactWebStompError(error)}`);
      });
      resolve();
    });
  }).catch(async (error) => {
    nextWss.close();
    listener = null;
    wss = null;
    activeConfig = null;
    onInboundMessage = null;
    accepting = false;
    transportLogger = NOOP_LOGGER;
    throw error;
  });

  running = true;
  heartbeatTimer = setInterval(() => {
    const now = Date.now();
    for (const [connectionId, state] of states) {
      if (!state.connected) continue;
      if (state.incomingHeartbeatMs > 0 && now - state.lastInboundAt > state.incomingHeartbeatMs * 2) {
        state.ws.close(1001, "STOMP heartbeat timeout");
        continue;
      }
      if (state.outgoingHeartbeatMs > 0 && now - state.lastOutboundAt >= state.outgoingHeartbeatMs) {
        sendRaw(connectionId, "\n");
      }
    }
  }, 1_000);
  heartbeatTimer.unref();
}

export async function stopStompServer(): Promise<void> {
  accepting = false;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  const config = activeConfig;
  const logger = transportLogger;
  const pendingQueues = [...states.values()].map((state) => state.queue.catch(() => undefined));
  for (const [connectionId, state] of states) {
    sendFrame(connectionId, buildErrorFrame("Server shutting down"));
    state.ws.terminate();
    cleanup(connectionId);
  }
  if (pendingQueues.length > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const drained = await Promise.race([
      Promise.all(pendingQueues).then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), config?.shutdownTimeoutMs ?? 10_000);
        timer.unref();
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (!drained) {
      logger.warn?.(
        `[openclaw-web-stomp] shutdown drain timed out after ${config?.shutdownTimeoutMs ?? 10_000}ms; ` +
        `${pendingQueues.length} connection queue(s) may still be completing`,
      );
    }
  }
  states.clear();
  clearSubscriptions();
  clearAckState();
  const closingWss = wss;
  const closingListener = listener;
  wss = null;
  listener = null;
  activeConfig = null;
  onInboundMessage = null;
  running = false;
  await new Promise<void>((resolve) => closingWss ? closingWss.close(() => resolve()) : resolve());
  await new Promise<void>((resolve) => closingListener ? closingListener.close(() => resolve()) : resolve());
  transportLogger = NOOP_LOGGER;
}

export async function publishToDestination(destination: string, body: string): Promise<number> {
  const config = activeConfig;
  if (!config) return 0;
  let delivered = 0;
  for (const subscription of getSubscribers(destination)) {
    const state = states.get(subscription.connectionId);
    if (!state || !state.connected || state.ws.readyState !== WebSocket.OPEN) continue;
    if (getPendingAckCount(subscription.connectionId) >= config.maxPendingAcks) {
      stats.droppedOutbound += 1;
      state.ws.close(1013, "Pending ACK limit exceeded");
      continue;
    }
    const messageId = registerMessage(subscription.id, subscription.connectionId, destination, subscription.ack);
    const sent = await sendFrameConfirmed(subscription.connectionId, buildMessageFrame(
      subscription.id,
      destination,
      messageId,
      body,
      subscription.ack === "auto" ? undefined : messageId,
    ));
    if (sent) delivered += 1;
    else {
      stats.droppedOutbound += 1;
      discardPendingMessage(messageId);
    }
  }
  return delivered;
}

export function getConnectionInfoList(): StompConnectionInfo[] {
  return [...states.values()].map((state) => ({ ...state.info }));
}

/** 返回 transport 运行状态；计数仅包含本次 start 生命周期。 */
export function getStompServerStats(): {
  running: boolean;
  connectionCount: number;
  subscriptionCount: number;
  pendingFrames: number;
  pendingAcks: number;
  wsPort: number | null;
  secure: boolean;
  rejectedConnections: number;
  authFailures: number;
  protocolErrors: number;
  droppedInbound: number;
  droppedOutbound: number;
} {
  return {
    running,
    connectionCount: states.size,
    subscriptionCount: [...states.keys()].reduce((total, id) => total + getConnectionSubscriptions(id).length, 0),
    pendingFrames: [...states.values()].reduce((total, state) => total + state.pending, 0),
    pendingAcks: [...states.keys()].reduce((total, id) => total + getPendingAckCount(id), 0),
    wsPort: activeConfig?.wsPort ?? null,
    secure: activeConfig?.tls.enabled ?? false,
    ...stats,
  };
}

export function getActiveStompConfig(): StompServerConfig | null {
  return activeConfig;
}
