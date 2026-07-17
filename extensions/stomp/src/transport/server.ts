/**
 * @fileoverview 加固的内嵌 STOMP 1.2 TCP/TLS 协议服务器。
 *
 * 实现 CONNECT、SEND、SUBSCRIBE、ACK/NACK、BEGIN/COMMIT/ABORT、UNSUBSCRIBE 和 DISCONNECT，覆盖登录认证、
 * Topic/Agent 路由、心跳协商、prefetch、三种 ACK 模式及进程内 durable subscription。
 * 每个连接均受帧大小、缓存、订阅数、队列深度、在途帧和分钟速率限制；相同连接的帧串行
 * 处理，慢订阅者通过有界队列和 Socket backpressure 隔离，停止时释放全部连接与定时器。
 */
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as net from "node:net";
import * as tls from "node:tls";

import { matchTopic as matchTopicShared } from "@partme.ai/openclaw-message-sdk/transport";

import { assertValidStompTcpConfig } from "../config.js";
import { redactStompTcpError } from "../shared/redact.js";
import type {
  InboundHandler,
  InboundMessage,
  StompAckMode,
  StompConnection,
  StompFrame,
  StompStatusSnapshot,
  StompTcpConfig,
  TopicBinding,
} from "../types.js";

type QueuedDelivery = { destination: string; body: string; redelivered?: boolean };
type PendingDelivery = QueuedDelivery & { ackId: string; subscriptionId: string };
type TransactionAction = { description: string; execute: () => Promise<void> | void };

type ActiveSubscription = {
  id: string;
  destination: string;
  ackMode: StompAckMode;
  prefetchCount: number;
  durableKey?: string;
  pending: Map<string, PendingDelivery>;
  queue: QueuedDelivery[];
};

type DurableSubscription = {
  key: string;
  user: string;
  id: string;
  destination: string;
  ackMode: StompAckMode;
  prefetchCount: number;
  queue: QueuedDelivery[];
};

type ConnectionState = {
  id: string;
  socket: net.Socket;
  remoteAddress: string;
  remotePort: number;
  secure: boolean;
  connected: boolean;
  cleaned: boolean;
  version: string;
  user?: string;
  connectedAt: string;
  subscriptions: Map<string, ActiveSubscription>;
  /** STOMP 本地事务缓冲；只保证本连接内命令有序提交，不承诺跨 Agent/外部系统原子回滚。 */
  transactions: Map<string, TransactionAction[]>;
  /** 所有未提交事务动作的连接级总量；防止事务数 × 单事务动作数形成平方级占用。 */
  transactionActionCount: number;
  buffer: Buffer;
  processing: Promise<void>;
  pendingFrames: number;
  windowStartedAt: number;
  windowMessages: number;
  lastInboundAt: number;
  lastOutboundAt: number;
  incomingHeartbeatMs: number;
  outgoingHeartbeatMs: number;
  connectTimer: ReturnType<typeof setTimeout>;
};

const stats: StompStatusSnapshot = {
  running: false,
  totalConnections: 0,
  totalSubscriptions: 0,
  durableSubscriptions: 0,
  routedInbound: 0,
  routedOutbound: 0,
  droppedInbound: 0,
  droppedOutbound: 0,
  ackPending: 0,
  activeTransactions: 0,
};

let tcpServer: net.Server | null = null;
let tlsServer: tls.Server | null = null;
let activeConfig: StompTcpConfig | null = null;
let inboundHandler: InboundHandler | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let accepting = false;
type TransportLogger = { error(message: string): void; warn?(message: string): void; info?(message: string): void };
const NOOP_LOGGER: TransportLogger = { error: () => undefined };
let transportLogger: TransportLogger = NOOP_LOGGER;
const connections = new Map<string, ConnectionState>();
const durableSubscriptions = new Map<string, DurableSubscription>();

const COMMANDS = new Set([
  "CONNECT", "STOMP", "SEND", "SUBSCRIBE", "UNSUBSCRIBE", "ACK", "NACK",
  "BEGIN", "COMMIT", "ABORT", "DISCONNECT",
]);

function normalizeDestinationTopic(destination: string): string {
  return destination.replace(/^\/(?:topic|queue|exchange)\//, "").replace(/^\/+/, "");
}

function matchTopic(pattern: string, destination: string): boolean {
  return matchTopicShared(normalizeDestinationTopic(destination), normalizeDestinationTopic(pattern));
}

function unescapeHeader(value: string): string | null {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== "\\") { result += char; continue; }
    const escaped = value[++index];
    if (escaped === "n") result += "\n";
    else if (escaped === "r") result += "\r";
    else if (escaped === "c") result += ":";
    else if (escaped === "\\") result += "\\";
    else return null;
  }
  return result;
}

function escapeHeader(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/:/g, "\\c");
}

function parseFrame(raw: Buffer): StompFrame | null {
  if (raw.at(-1) !== 0) return null;
  const text = raw.subarray(0, -1).toString("utf8");
  const separator = text.search(/\r?\n\r?\n/);
  if (separator < 0) return null;
  const headerText = text.slice(0, separator).replace(/\r\n/g, "\n");
  const separatorLength = text.startsWith("\r\n\r\n", separator) ? 4 : 2;
  const body = text.slice(separator + separatorLength);
  const lines = headerText.split("\n");
  const command = lines.shift()?.trim().toUpperCase() ?? "";
  if (!COMMANDS.has(command)) return null;
  // STOMP 1.2 规定 CONNECT/STOMP/CONNECTED 不进行 header 转义，其余帧才应用反斜杠转义。
  const escapedHeaders = command !== "CONNECT" && command !== "STOMP";
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon <= 0) return null;
    const key = escapedHeaders ? unescapeHeader(line.slice(0, colon)) : line.slice(0, colon);
    const value = escapedHeaders ? unescapeHeader(line.slice(colon + 1)) : line.slice(colon + 1);
    if (key === null || value === null) return null;
    // STOMP 1.2：重复 header 以第一个值为准，后续重复值不能覆盖认证或路由字段。
    if (key in headers) continue;
    headers[key] = value;
  }
  if (headers["content-length"] !== undefined) {
    if (!/^\d+$/.test(headers["content-length"])) return null;
    if (Buffer.byteLength(body, "utf8") !== Number(headers["content-length"])) return null;
  }
  return { command, headers, body };
}

function buildFrame(command: string, headers: Record<string, string | undefined>, body = ""): string {
  const entries = Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== undefined);
  if (body && !entries.some(([key]) => key === "content-length")) {
    entries.push(["content-length", String(Buffer.byteLength(body, "utf8"))]);
  }
  const encode = command === "CONNECTED" ? (value: string) => value : escapeHeader;
  return `${command}\n${entries.map(([key, value]) => `${encode(key)}:${encode(value)}`).join("\n")}\n\n${body}\0`;
}

function locateFrameEnd(buffer: Buffer): number {
  const text = buffer.toString("latin1");
  const lfSeparator = text.indexOf("\n\n");
  const crlfSeparator = text.indexOf("\r\n\r\n");
  const separator = lfSeparator < 0 ? crlfSeparator : crlfSeparator < 0 ? lfSeparator : Math.min(lfSeparator, crlfSeparator);
  if (separator < 0) return -1;
  const separatorLength = text.startsWith("\r\n\r\n", separator) ? 4 : 2;
  const headerText = buffer.subarray(0, separator).toString("utf8").replace(/\r\n/g, "\n");
  const contentLength = headerText.split("\n").find((line) => line.startsWith("content-length:"))?.slice(15);
  if (contentLength !== undefined) {
    if (!/^\d+$/.test(contentLength)) return -2;
    const nulIndex = separator + separatorLength + Number(contentLength);
    if (buffer.length <= nulIndex) return -1;
    return buffer[nulIndex] === 0 ? nulIndex + 1 : -2;
  }
  const nul = buffer.indexOf(0, separator + separatorLength);
  return nul < 0 ? -1 : nul + 1;
}

function secureEqual(left: string, right: string): boolean {
  const a = createHash("sha256").update(left, "utf8").digest();
  const b = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(a, b);
}

function authenticate(login: string | undefined, passcode: string | undefined, config: StompTcpConfig): boolean {
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

function sendRaw(state: ConnectionState, payload: string): boolean {
  const config = activeConfig;
  if (!config || state.socket.destroyed || !state.socket.writable) return false;
  const bytes = Buffer.byteLength(payload, "utf8");
  if (state.socket.writableLength + bytes > config.maxBufferedBytes) {
    stats.droppedOutbound += 1;
    // 策略性断开已有 dropped 指标，不制造可由客户端放大的 Socket error 日志。
    state.socket.destroy();
    return false;
  }
  state.socket.write(payload);
  state.lastOutboundAt = Date.now();
  return true;
}

function sendFrame(state: ConnectionState, command: string, headers: Record<string, string | undefined>, body = ""): boolean {
  return sendRaw(state, buildFrame(command, headers, body));
}

function failProtocol(state: ConnectionState, message: string, receiptId?: string, close = false): void {
  sendFrame(state, "ERROR", { message, "receipt-id": receiptId }, message);
  if (close) state.socket.end();
}

function allowedAgent(agentId: string, config: StompTcpConfig): boolean {
  return agentId === config.defaultAgentId || config.allowedAgentIds.includes(agentId);
}

function findBinding(destination: string, config: StompTcpConfig): TopicBinding | undefined {
  return config.topicBindings.find((binding) => matchTopic(binding.topicPattern, destination));
}

function resolveInboundRoute(destination: string, state: ConnectionState, config: StompTcpConfig): Omit<InboundMessage, "rawPayload" | "idempotencyKey"> {
  const binding = findBinding(destination, config);
  const match = destination.match(/^\/queue\/agent(?:[./]([^/]+))?$/);
  if (!binding && !match) throw new Error("SEND destination is not configured");
  const agentId = binding?.agentId ?? match?.[1] ?? config.defaultAgentId;
  if (!binding && !allowedAgent(agentId, config)) throw new Error(`Agent is not allowed: ${agentId}`);
  const peerId = `stomp-tcp:${state.id}@${agentId}`;
  return {
    agentId,
    accountId: binding?.accountId ?? "default",
    peerId,
    destination,
    replyDestination: binding?.replyTopic,
  };
}

function subscriptionAllowed(state: ConnectionState, destination: string, config: StompTcpConfig): boolean {
  if (config.allowSharedTopics) return true;
  return [...new Set([config.defaultAgentId, ...config.allowedAgentIds, ...config.topicBindings.map((item) => item.agentId)])]
    .some((agentId) => destination === `/topic/session.stomp-tcp:${state.id}@${agentId}`);
}

function enqueue(queue: QueuedDelivery[], delivery: QueuedDelivery, config: StompTcpConfig): boolean {
  if (queue.length >= config.maxQueueDepthPerSubscription) {
    stats.droppedOutbound += 1;
    return false;
  }
  queue.push(delivery);
  return true;
}

function flushSubscription(state: ConnectionState, subscription: ActiveSubscription): void {
  const config = activeConfig;
  if (!config || state.socket.destroyed || state.socket.writableNeedDrain) return;
  while (subscription.queue.length > 0) {
    if (state.socket.writableNeedDrain) return;
    if (subscription.ackMode !== "auto" && subscription.pending.size >= subscription.prefetchCount) return;
    const delivery = subscription.queue.shift();
    if (!delivery) return;
    const messageId = randomUUID();
    const ackId = randomUUID();
    if (subscription.ackMode !== "auto") {
      subscription.pending.set(ackId, { ...delivery, ackId, subscriptionId: subscription.id });
      stats.ackPending += 1;
    }
    const sent = sendFrame(state, "MESSAGE", {
      destination: delivery.destination,
      "message-id": messageId,
      subscription: subscription.id,
      "content-type": "text/plain;charset=utf-8",
      ack: subscription.ackMode === "auto" ? undefined : ackId,
      redelivered: delivery.redelivered ? "true" : undefined,
    }, delivery.body);
    if (!sent) {
      if (subscription.ackMode !== "auto" && subscription.pending.delete(ackId)) {
        stats.ackPending = Math.max(0, stats.ackPending - 1);
      }
      // durable 队列已经从共享 queue shift，发送失败时必须放回，否则一次背压即可造成静默丢失。
      if (subscription.durableKey) subscription.queue.unshift({ ...delivery, redelivered: true });
      return;
    }
    stats.routedOutbound += 1;
  }
}

function durableKey(user: string, id: string, destination: string): string {
  return `${user}\0${id}\0${destination}`;
}

function handleSubscribe(state: ConnectionState, frame: StompFrame, config: StompTcpConfig): void {
  const id = frame.headers.id;
  const destination = frame.headers.destination;
  const ack = (frame.headers.ack ?? config.defaultAckMode) as StompAckMode;
  if (!id || !destination) throw new Error("SUBSCRIBE requires id and destination");
  if (ack !== "auto" && ack !== "client" && ack !== "client-individual") throw new Error("Invalid SUBSCRIBE ack mode");
  if (state.subscriptions.has(id)) throw new Error(`Duplicate subscription id: ${id}`);
  if (!subscriptionAllowed(state, destination, config)) throw new Error("Subscription is outside this connection's session scope");
  if (state.subscriptions.size >= config.maxSubscriptionsPerConnection) throw new Error("Subscription limit exceeded");
  const prefetchRaw = Number(frame.headers["prefetch-count"] ?? config.prefetchCount);
  const prefetchCount = Number.isInteger(prefetchRaw) && prefetchRaw > 0 ? Math.min(prefetchRaw, config.prefetchCount) : config.prefetchCount;
  const durable = frame.headers.durable === "true" || frame.headers.persistent === "true";
  if (durable && !config.allowDurableSubscriptions) throw new Error("Durable subscriptions are disabled");
  let queue: QueuedDelivery[] = [];
  let key: string | undefined;
  if (durable) {
    key = durableKey(state.user ?? "anonymous", id, destination);
    let persisted = durableSubscriptions.get(key);
    if (!persisted) {
      if (durableSubscriptions.size >= config.maxDurableSubscriptions) throw new Error("Durable subscription limit exceeded");
      persisted = { key, user: state.user ?? "anonymous", id, destination, ackMode: ack, prefetchCount, queue: [] };
      durableSubscriptions.set(key, persisted);
    }
    queue = persisted.queue;
  }
  const subscription: ActiveSubscription = { id, destination, ackMode: ack, prefetchCount, durableKey: key, pending: new Map(), queue };
  state.subscriptions.set(id, subscription);
  flushSubscription(state, subscription);
}

function requeuePending(subscription: ActiveSubscription, deliveries: PendingDelivery[]): void {
  const limit = activeConfig?.maxQueueDepthPerSubscription ?? 0;
  for (const delivery of deliveries.reverse()) {
    if (limit > 0 && subscription.queue.length >= limit) {
      stats.droppedOutbound += 1;
      continue;
    }
    subscription.queue.unshift({ destination: delivery.destination, body: delivery.body, redelivered: true });
  }
}

function removeSubscription(state: ConnectionState, id: string, deleteDurable: boolean): void {
  const subscription = state.subscriptions.get(id);
  if (!subscription) throw new Error("Unknown subscription id");
  const pending = [...subscription.pending.values()];
  stats.ackPending = Math.max(0, stats.ackPending - pending.length);
  requeuePending(subscription, pending);
  subscription.pending.clear();
  state.subscriptions.delete(id);
  if (deleteDurable && subscription.durableKey) durableSubscriptions.delete(subscription.durableKey);
}

function handleAck(state: ConnectionState, frame: StompFrame, nack: boolean): void {
  const ackId = frame.headers.id ?? frame.headers.ack;
  if (!ackId) throw new Error(`${nack ? "NACK" : "ACK"} requires id`);
  for (const subscription of state.subscriptions.values()) {
    const ids = [...subscription.pending.keys()];
    const position = ids.indexOf(ackId);
    if (position < 0) continue;
    const affected = subscription.ackMode === "client" ? ids.slice(0, position + 1) : [ackId];
    const deliveries = affected.flatMap((id) => {
      const delivery = subscription.pending.get(id);
      subscription.pending.delete(id);
      return delivery ? [delivery] : [];
    });
    stats.ackPending = Math.max(0, stats.ackPending - deliveries.length);
    if (nack && frame.headers.requeue !== "false") requeuePending(subscription, deliveries);
    flushSubscription(state, subscription);
    return;
  }
  throw new Error("Unknown ACK id");
}

/** 读取 STOMP 事务 id；BEGIN/COMMIT/ABORT 以及事务内命令都使用同一 header。 */
function transactionId(frame: StompFrame): string {
  const id = frame.headers.transaction?.trim();
  if (!id) throw new Error(`${frame.command} requires transaction header`);
  return id;
}

/** 将 SEND/ACK/NACK 暂存到连接级事务，限制动作数以防客户端无限占用内存。 */
function enqueueTransactionAction(
  state: ConnectionState,
  id: string,
  action: TransactionAction,
  config: StompTcpConfig,
): void {
  const actions = state.transactions.get(id);
  if (!actions) throw new Error(`Unknown transaction: ${id}`);
  if (state.transactionActionCount >= config.maxPendingMessages) {
    throw new Error("Connection transaction action limit exceeded");
  }
  actions.push(action);
  state.transactionActionCount += 1;
}

/** 完成 SEND 的路由和 Agent dispatch；事务与非事务路径复用同一成功语义。 */
async function dispatchSend(state: ConnectionState, frame: StompFrame, config: StompTcpConfig): Promise<void> {
  const destination = frame.headers.destination;
  if (!destination) throw new Error("SEND requires destination");
  if (config.subscribeTopics.length > 0 && !config.subscribeTopics.some((pattern) => matchTopic(pattern, destination))) {
    throw new Error("SEND destination is not allowlisted");
  }
  const route = resolveInboundRoute(destination, state, config);
  if (!inboundHandler) throw new Error("STOMP inbound handler is not initialized");
  try {
    await inboundHandler({
      ...route,
      rawPayload: frame.body,
      // 只有调用方明确提供 message-id 才启用幂等；正文相同的两条合法消息不能被永久合并。
      idempotencyKey: frame.headers["message-id"]?.trim() || undefined,
    });
  } catch (error) {
    // 普通 SEND 与事务 COMMIT 都经过这里：内部异常只写脱敏日志，协议层返回稳定错误。
    transportLogger.error(`[openclaw-stomp] Agent dispatch failed connection=${state.id}: ${redactStompTcpError(error)}`);
    throw new Error("Agent dispatch failed");
  }
  stats.routedInbound += 1;
}

async function handleFrame(state: ConnectionState, frame: StompFrame, config: StompTcpConfig): Promise<void> {
  const receiptId = frame.headers.receipt;
  if (!state.connected && frame.command !== "CONNECT" && frame.command !== "STOMP") {
    failProtocol(state, "CONNECT is required before other commands", receiptId, true);
    return;
  }
  try {
    switch (frame.command) {
      case "CONNECT":
      case "STOMP": {
        if (state.connected) throw new Error("STOMP session is already connected");
        const versions = (frame.headers["accept-version"] ?? "").split(",").map((item) => item.trim());
        if (!versions.includes("1.2")) throw new Error("Only STOMP 1.2 is supported");
        if (!authenticate(frame.headers.login, frame.headers.passcode, config)) throw new Error("Authentication failed");
        const [clientOutgoing, clientIncoming] = parseHeartBeat(frame.headers["heart-beat"]);
        state.incomingHeartbeatMs = clientOutgoing > 0 && config.heartbeat.clientMs > 0 ? Math.max(clientOutgoing, config.heartbeat.clientMs) : 0;
        state.outgoingHeartbeatMs = clientIncoming > 0 && config.heartbeat.serverMs > 0 ? Math.max(clientIncoming, config.heartbeat.serverMs) : 0;
        state.connected = true;
        state.version = "1.2";
        state.user = frame.headers.login ?? "anonymous";
        clearTimeout(state.connectTimer);
        sendFrame(state, "CONNECTED", {
          version: "1.2",
          server: "openclaw-stomp/2026.7.1",
          session: state.id,
          "heart-beat": `${config.heartbeat.serverMs},${config.heartbeat.clientMs}`,
        });
        return;
      }
      case "SEND": {
        const transaction = frame.headers.transaction?.trim();
        if (transaction) {
          enqueueTransactionAction(state, transaction, {
            description: `SEND ${frame.headers.destination ?? "<missing>"}`,
            execute: () => dispatchSend(state, frame, config),
          }, config);
        } else {
          await dispatchSend(state, frame, config);
        }
        break;
      }
      case "SUBSCRIBE":
        handleSubscribe(state, frame, config);
        break;
      case "UNSUBSCRIBE":
        if (!frame.headers.id) throw new Error("UNSUBSCRIBE requires id");
        removeSubscription(state, frame.headers.id, true);
        break;
      case "ACK":
        if (frame.headers.transaction) {
          enqueueTransactionAction(state, transactionId(frame), {
            description: "ACK",
            execute: () => handleAck(state, frame, false),
          }, config);
        } else handleAck(state, frame, false);
        break;
      case "NACK":
        if (frame.headers.transaction) {
          enqueueTransactionAction(state, transactionId(frame), {
            description: "NACK",
            execute: () => handleAck(state, frame, true),
          }, config);
        } else handleAck(state, frame, true);
        break;
      case "BEGIN": {
        const id = transactionId(frame);
        if (state.transactions.has(id)) throw new Error(`Transaction already exists: ${id}`);
        if (state.transactions.size >= config.maxPendingMessages) throw new Error("Transaction limit exceeded");
        state.transactions.set(id, []);
        break;
      }
      case "COMMIT": {
        const id = transactionId(frame);
        const actions = state.transactions.get(id);
        if (!actions) throw new Error(`Unknown transaction: ${id}`);
        // 提交前先移除，防止 action 抛错后重复 COMMIT 导致已完成的 Agent 副作用再次执行。
        state.transactions.delete(id);
        state.transactionActionCount = Math.max(0, state.transactionActionCount - actions.length);
        for (const action of actions) await action.execute();
        break;
      }
      case "ABORT": {
        const id = transactionId(frame);
        const actions = state.transactions.get(id);
        if (!actions || !state.transactions.delete(id)) throw new Error(`Unknown transaction: ${id}`);
        state.transactionActionCount = Math.max(0, state.transactionActionCount - actions.length);
        break;
      }
      case "DISCONNECT":
        if (receiptId) sendFrame(state, "RECEIPT", { "receipt-id": receiptId });
        state.socket.end();
        return;
      default:
        throw new Error(`Unsupported STOMP command: ${frame.command}`);
    }
    if (receiptId) sendFrame(state, "RECEIPT", { "receipt-id": receiptId });
  } catch (error) {
    if (frame.command === "SEND") stats.droppedInbound += 1;
    failProtocol(state, error instanceof Error ? error.message : String(error), receiptId, frame.command === "CONNECT" || frame.command === "STOMP");
  }
}

function cleanup(state: ConnectionState): void {
  if (state.cleaned) return;
  state.cleaned = true;
  clearTimeout(state.connectTimer);
  for (const subscription of state.subscriptions.values()) {
    const pending = [...subscription.pending.values()];
    stats.ackPending = Math.max(0, stats.ackPending - pending.length);
    if (subscription.durableKey) requeuePending(subscription, pending);
  }
  state.subscriptions.clear();
  state.transactions.clear();
  state.transactionActionCount = 0;
  connections.delete(state.id);
  stats.totalConnections = connections.size;
}

function enqueueFrame(state: ConnectionState, frame: StompFrame, config: StompTcpConfig): void {
  if (!accepting) {
    state.socket.destroy();
    return;
  }
  const now = Date.now();
  if (now - state.windowStartedAt >= 60_000) { state.windowStartedAt = now; state.windowMessages = 0; }
  if (++state.windowMessages > config.messagesPerMinute) {
    stats.droppedInbound += 1;
    state.socket.destroy();
    return;
  }
  if (state.pendingFrames >= config.maxPendingMessages) {
    stats.droppedInbound += 1;
    state.socket.destroy();
    return;
  }
  state.pendingFrames += 1;
  state.processing = state.processing
    .then(() => handleFrame(state, frame, config))
    .catch((error: unknown) => {
      transportLogger.error(`[openclaw-stomp] frame processing failed connection=${state.id}: ${redactStompTcpError(error)}`);
      failProtocol(state, "Frame processing failed");
    })
    .finally(() => { state.pendingFrames -= 1; });
}

function handleConnection(socket: net.Socket, secure: boolean, config: StompTcpConfig): void {
  if (!accepting) {
    socket.destroy();
    return;
  }
  if (connections.size >= config.maxConnections) {
    socket.end(buildFrame("ERROR", { message: "STOMP connection limit exceeded" }, "STOMP connection limit exceeded"));
    return;
  }
  socket.setNoDelay(true);
  socket.setKeepAlive(true, 30_000);
  const now = Date.now();
  const state: ConnectionState = {
    id: randomUUID(),
    socket,
    remoteAddress: socket.remoteAddress ?? "unknown",
    remotePort: socket.remotePort ?? 0,
    secure,
    connected: false,
    cleaned: false,
    version: "pending",
    connectedAt: new Date(now).toISOString(),
    subscriptions: new Map(),
    transactions: new Map(),
    transactionActionCount: 0,
    buffer: Buffer.alloc(0),
    processing: Promise.resolve(),
    pendingFrames: 0,
    windowStartedAt: now,
    windowMessages: 0,
    lastInboundAt: now,
    lastOutboundAt: now,
    incomingHeartbeatMs: 0,
    outgoingHeartbeatMs: 0,
    connectTimer: setTimeout(() => failProtocol(state, "STOMP CONNECT timeout", undefined, true), config.connectTimeoutMs),
  };
  state.connectTimer.unref();
  connections.set(state.id, state);
  stats.totalConnections = connections.size;

  socket.on("data", (chunk) => {
    if (!accepting) {
      socket.destroy();
      return;
    }
    state.lastInboundAt = Date.now();
    state.buffer = Buffer.concat([state.buffer, chunk]);
    while (state.buffer[0] === 10 || (state.buffer[0] === 13 && state.buffer[1] === 10)) {
      state.buffer = state.buffer.subarray(state.buffer[0] === 10 ? 1 : 2);
    }
    let end = locateFrameEnd(state.buffer);
    while (end !== -1) {
      if (end === -2) {
        failProtocol(state, "Malformed content-length", undefined, true);
        return;
      }
      if (end > config.maxFrameSize) {
        failProtocol(state, "STOMP frame exceeds maxFrameSize", undefined, true);
        return;
      }
      const raw = state.buffer.subarray(0, end);
      state.buffer = state.buffer.subarray(end);
      const parsed = parseFrame(raw);
      if (!parsed) failProtocol(state, "Malformed STOMP frame", undefined, true);
      else enqueueFrame(state, parsed, config);
      while (state.buffer[0] === 10 || (state.buffer[0] === 13 && state.buffer[1] === 10)) {
        state.buffer = state.buffer.subarray(state.buffer[0] === 10 ? 1 : 2);
      }
      end = locateFrameEnd(state.buffer);
    }
    if (state.buffer.length > config.maxFrameSize) {
      failProtocol(state, "STOMP frame exceeds maxFrameSize", undefined, true);
    }
  });
  socket.on("drain", () => {
    for (const subscription of state.subscriptions.values()) flushSubscription(state, subscription);
  });
  socket.on("close", () => cleanup(state));
  socket.on("error", (error) => {
    transportLogger.error(`[openclaw-stomp] connection error id=${state.id}: ${redactStompTcpError(error)}`);
    cleanup(state);
  });
}

async function listen(server: net.Server, port: number, host: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      server.on("error", (error) => {
        transportLogger.error(`[openclaw-stomp] listener error: ${redactStompTcpError(error)}`);
      });
      resolve();
    });
  });
}

async function closeServer(server: net.Server | tls.Server | null): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

/** 校验配置并启动 TCP/TLS 监听器与全局心跳维护任务。 */
export async function startStompTcpServer(
  config: StompTcpConfig,
  onInbound: InboundHandler,
  logger?: TransportLogger,
): Promise<void> {
  if (stats.running) return;
  assertValidStompTcpConfig(config);
  activeConfig = config;
  inboundHandler = onInbound;
  transportLogger = logger ?? NOOP_LOGGER;
  accepting = true;
  try {
    if (config.port > 0) {
      tcpServer = net.createServer((socket) => handleConnection(socket, false, config));
      await listen(tcpServer, config.port, config.host);
    }
    if (config.tls.enabled) {
      const [key, cert, ca] = await Promise.all([
        readFile(config.tls.keyFile!),
        readFile(config.tls.certFile!),
        config.tls.caFile ? readFile(config.tls.caFile) : Promise.resolve(undefined),
      ]);
      tlsServer = tls.createServer({
        key,
        cert,
        ca,
        minVersion: config.tls.minVersion,
        requestCert: config.tls.requestCert,
        rejectUnauthorized: config.tls.rejectUnauthorized,
      }, (socket) => handleConnection(socket, true, config));
      await listen(tlsServer, config.tlsPort, config.tls.host);
    }
  } catch (error) {
    await closeServer(tlsServer);
    await closeServer(tcpServer);
    tcpServer = null;
    tlsServer = null;
    activeConfig = null;
    inboundHandler = null;
    accepting = false;
    transportLogger = NOOP_LOGGER;
    throw error;
  }
  stats.running = true;
  const heartbeatValues = [config.heartbeat.serverMs, config.heartbeat.clientMs].filter((value) => value > 0);
  const intervalMs = Math.min(1_000, Math.max(50, Math.min(...heartbeatValues, 2_000) / 2));
  heartbeatTimer = setInterval(() => {
    const now = Date.now();
    for (const state of connections.values()) {
      if (!state.connected) continue;
      if (state.incomingHeartbeatMs > 0 && now - state.lastInboundAt > state.incomingHeartbeatMs * 2) {
        state.socket.destroy();
      } else if (state.outgoingHeartbeatMs > 0 && now - state.lastOutboundAt >= state.outgoingHeartbeatMs) {
        sendRaw(state, "\n");
      }
    }
  }, intervalMs);
  heartbeatTimer.unref();
}

/** 幂等关闭所有连接、监听器、心跳和进程内 durable subscription。 */
export async function stopStompTcpServer(): Promise<void> {
  accepting = false;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  const config = activeConfig;
  const logger = transportLogger;
  const pendingProcessing = [...connections.values()].map((state) => state.processing.catch(() => undefined));
  for (const state of connections.values()) {
    sendFrame(state, "ERROR", { message: "Server shutting down" }, "Server shutting down");
    state.socket.destroy();
    cleanup(state);
  }
  if (pendingProcessing.length > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const drained = await Promise.race([
      Promise.all(pendingProcessing).then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), config?.shutdownTimeoutMs ?? 10_000);
        timer.unref();
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (!drained) {
      logger.warn?.(
        `[openclaw-stomp] shutdown drain timed out after ${config?.shutdownTimeoutMs ?? 10_000}ms; ` +
        `${pendingProcessing.length} connection queue(s) may still be completing`,
      );
    }
  }
  connections.clear();
  await Promise.all([closeServer(tlsServer), closeServer(tcpServer)]);
  tcpServer = null;
  tlsServer = null;
  activeConfig = null;
  inboundHandler = null;
  durableSubscriptions.clear();
  transportLogger = NOOP_LOGGER;
  Object.assign(stats, {
    running: false,
    totalConnections: 0,
    totalSubscriptions: 0,
    durableSubscriptions: 0,
    routedInbound: 0,
    routedOutbound: 0,
    droppedInbound: 0,
    droppedOutbound: 0,
    ackPending: 0,
    activeTransactions: 0,
  });
}

/** 将一条 Agent 出站消息投递到在线或进程内 durable 订阅队列，返回接收订阅数。 */
export function publishToDestination(destination: string, body: string): number {
  const config = activeConfig;
  if (!config) return 0;
  let accepted = 0;
  const activeDurable = new Set<string>();
  for (const state of connections.values()) {
    if (!state.connected) continue;
    for (const subscription of state.subscriptions.values()) {
      if (subscription.destination !== destination) continue;
      if (subscription.durableKey) activeDurable.add(subscription.durableKey);
      if (enqueue(subscription.queue, { destination, body }, config)) {
        accepted += 1;
        flushSubscription(state, subscription);
      }
    }
  }
  for (const durable of durableSubscriptions.values()) {
    if (durable.destination !== destination || activeDurable.has(durable.key)) continue;
    if (enqueue(durable.queue, { destination, body }, config)) accepted += 1;
  }
  return accepted;
}

export function getConnectionInfoList(): StompConnection[] {
  return [...connections.values()].map((state) => ({
    id: state.id,
    remoteAddress: state.remoteAddress,
    remotePort: state.remotePort,
    secure: state.secure,
    connected: state.connected,
    version: state.version,
    user: state.user,
    connectedAt: state.connectedAt,
    subscriptions: [...state.subscriptions.values()].map((item) => item.destination),
    inflightCount: [...state.subscriptions.values()].reduce((sum, item) => sum + item.pending.size, 0),
    queuedCount: [...state.subscriptions.values()].reduce((sum, item) => sum + item.queue.length, 0),
    transactionCount: state.transactions.size,
  }));
}

export function getConnectionStats(): { total: number; byVersion: Record<string, number>; secure: number } {
  const byVersion: Record<string, number> = {};
  let secure = 0;
  for (const state of connections.values()) {
    byVersion[state.version] = (byVersion[state.version] ?? 0) + 1;
    if (state.secure) secure += 1;
  }
  return { total: connections.size, byVersion, secure };
}

export function getStatusSnapshot(): StompStatusSnapshot {
  stats.totalConnections = connections.size;
  stats.totalSubscriptions = [...connections.values()].reduce((sum, state) => sum + state.subscriptions.size, 0);
  stats.durableSubscriptions = durableSubscriptions.size;
  stats.activeTransactions = [...connections.values()].reduce((sum, state) => sum + state.transactions.size, 0);
  return { ...stats };
}

export function getActiveStompTcpConfig(): StompTcpConfig | null { return activeConfig; }
