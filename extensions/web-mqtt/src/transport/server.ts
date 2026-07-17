/**
 * WebSocket MQTT 服务实现。
 *
 * 浏览器 / MQTT.js
 *       │ WebSocket Upgrade（Origin、连接数、帧大小）
 *       ▼
 * HTTP(S) + ws ──▶ Aedes（认证、Topic ACL、QoS 确认）
 *                       │
 *                       ▼
 *              clientId 有界串行队列
 *                       │
 *                       ▼
 *              OpenClaw Agent 入站处理
 *
 * 这里的 Aedes 是单 Gateway 进程内接入 broker，不提供跨实例会话恢复或持久订阅。
 * QoS 1 的成功确认会等待 Agent Turn 与回复发布完成；停机则先拒绝新任务，再排空队列。
 */

import { Aedes } from "aedes";
import type { Client, Subscription, PublishPacket } from "aedes";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { readFileSync } from "node:fs";
import type { Duplex } from "node:stream";
import type { Socket } from "node:net";
import { WebSocketServer, createWebSocketStream, type WebSocket } from "ws";
import {
  verifyPassword as verifyPasswordShared,
  safeEqualBuffer,
  matchTopic as matchTopicShared,
  isValidMqttTopicName,
} from "@partme.ai/openclaw-message-sdk/transport";
import { createKeyedRunQueue, type KeyedRunQueue } from "@partme.ai/openclaw-message-sdk";
import type { InboundHandler, WebMqttConfig, WebMqttServiceStats } from "../types.js";
import { isUserActionAllowed } from "./acl.js";
import { validateWebMqttConfig } from "../config.js";
import { clearSessionContexts, removeSessionContextsByClient } from "../routing/session-mapper.js";
import { redactWebMqttError } from "../shared/redact.js";

type AedesBroker = Aedes;

let broker: AedesBroker | null = null;
let server: HttpServer | HttpsServer | null = null;
let wss: InstanceType<typeof WebSocketServer> | null = null;
let currentConfig: WebMqttConfig | null = null;
let inboundQueue: KeyedRunQueue | null = null;
const connectedClients = new Map<string, Client>();
let clientUsernameMap = new WeakMap<Client, string>();
const pendingClients = new Set<Client>();
let clientSubscriptions = new WeakMap<Client, Set<string>>();

const stats: WebMqttServiceStats = {
  connectedClients: 0,
  rejectedConnections: 0,
  authFailures: 0,
  aclDenials: 0,
  acceptedMessages: 0,
  droppedMessages: 0,
  routedByBinding: 0,
  routedByStandard: 0,
  outboundMessages: 0,
  inboundQueued: 0,
  inboundActive: 0,
  brokerReady: false,
};

/**
 * 启动服务。
 */
export async function startWebMqttServer(config: WebMqttConfig, onInbound: InboundHandler): Promise<void> {
  if (broker || server || wss) throw new Error("[openclaw-web-mqtt] server is already running");
  const issues = validateWebMqttConfig(config);
  if (issues.length > 0) throw new Error(`[openclaw-web-mqtt] invalid configuration: ${issues.join(" ")}`);
  resetStats();
  currentConfig = config;
  try {
    inboundQueue = createKeyedRunQueue({
      taskTimeoutMs: config.limits.inboundTaskTimeoutMs,
      onError: (error, clientId) => {
        const safeError = redactWebMqttError(error, config);
        trackInboundDropped(`inbound_dispatch_error:${safeError}`);
        stats.lastError = `[${clientId}] ${safeError}`;
      },
    });
    broker = new Aedes({ heartbeatInterval: 30000 });
    broker.preConnect = (_client, _packet, done) => {
      done(null, true);
    };
    bindBrokerEventHandlers();
    configureAuthGuards(config, onInbound);
    // Aedes 1.x 需要显式完成持久化 setup 后才可接受连接，否则 WebSocket 已建立但无 CONNACK。
    await broker.listen();

    server = createWebServer(config);
    // Upgrade 前的普通 HTTP 请求只用于握手，限制慢 Header/长请求占用连接资源。
    server.headersTimeout = 10_000;
    server.requestTimeout = 15_000;
    server.keepAliveTimeout = 5_000;
    wss = new WebSocketServer({
      server,
      path: config.path,
      perMessageDeflate: config.ws.compress,
      maxPayload: config.ws.maxFrameSize,
      clientTracking: true,
      verifyClient: (info, done) => {
        const origin = info.origin;
        if (wss && wss.clients.size >= config.maxConnections) {
          stats.rejectedConnections += 1;
          stats.lastError = "maximum_connections_reached";
          done(false, 503, "maximum connections reached");
          return;
        }
        if (origin && !isAllowedBrowserOrigin(origin, config.ws.allowedOrigins)) {
          stats.rejectedConnections += 1;
          stats.lastError = "origin_forbidden";
          done(false, 403, "origin forbidden");
          return;
        }
        done(true);
      },
    });

    wss.on("connection", (ws) => {
      const stream = createDuplexFromWs(ws, config.ws.idleTimeoutMs);
      broker!.handle(stream as unknown as Socket);
    });

    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(config.port, config.host, () => {
        server!.off("error", reject);
        resolve();
      });
    });
    stats.brokerReady = true;
  } catch (error) {
    await stopWebMqttServer().catch(() => undefined);
    throw new Error(redactWebMqttError(error, config));
  }
}

/**
 * 停止服务。
 */
export async function stopWebMqttServer(): Promise<void> {
  const activeWss = wss;
  const activeServer = server;
  const activeBroker = broker;
  const queue = inboundQueue;
  const stoppingConfig = currentConfig;
  wss = null;
  server = null;
  broker = null;
  inboundQueue = null;
  currentConfig = null;
  queue?.deactivate();
  const drainQueue = queue?.drain() ?? Promise.resolve();
  activeWss?.clients.forEach((client) => client.terminate());

  const closeWss = new Promise<void>((resolve) => {
    if (!activeWss) return resolve();
    activeWss.close(() => resolve());
  });
  const closeServer = new Promise<void>((resolve, reject) => {
    if (!activeServer) return resolve();
    activeServer.close((error) => (error ? reject(error) : resolve()));
  });
  const closeBroker = new Promise<void>((resolve) => {
    if (!activeBroker) return resolve();
    activeBroker.close(() => resolve());
  });
  // WebSocket/HTTP/Aedes 关闭与已开始的 Agent 任务同时收敛；stop 返回后不留后台 dispatch。
  const results = await Promise.allSettled([closeWss, closeServer, closeBroker, drainQueue]);
  stats.connectedClients = 0;
  stats.brokerReady = false;
  connectedClients.clear();
  clientUsernameMap = new WeakMap<Client, string>();
  clientSubscriptions = new WeakMap<Client, Set<string>>();
  pendingClients.clear();
  clearSessionContexts();
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure) throw new Error(redactWebMqttError(failure.reason, stoppingConfig));
}

/**
 * 获取状态。
 */
export function getStats(): WebMqttServiceStats {
  const queue = inboundQueue?.snapshot();
  return {
    ...stats,
    inboundQueued: queue?.queuedCount ?? 0,
    inboundActive: queue?.activeCount ?? 0,
  };
}

/**
 * 更新路由统计。
 */
export function trackRoute(source: "binding" | "standard"): void {
  if (source === "binding") stats.routedByBinding += 1;
  else stats.routedByStandard += 1;
}

/**
 * 发布消息到 topic。
 *
 * @returns 发布完成时 resolve；broker 未就绪或 Aedes 回调报错时 reject
 */
export async function publishToTopic(topic: string, payload: string): Promise<number> {
  if (!broker) {
    throw new Error("[openclaw-web-mqtt] Cannot publish — broker not running");
  }
  if (!isValidMqttTopicName(topic)) {
    stats.lastError = "invalid_outbound_topic";
    throw new Error(`[openclaw-web-mqtt] Invalid outbound MQTT Topic Name: ${topic}`);
  }
  const payloadBytes = Buffer.byteLength(payload, "utf-8");
  if (currentConfig && payloadBytes > currentConfig.limits.maxPayloadBytes) {
    stats.lastError = "outbound_payload_too_large";
    throw new Error(
      `[openclaw-web-mqtt] Cannot publish — payload exceeds maxPayloadBytes(${currentConfig.limits.maxPayloadBytes})`,
    );
  }
  const delivered = countActiveSubscribers(topic);
  await new Promise<void>((resolve, reject) => {
    broker!.publish(
      {
        topic,
        payload: Buffer.from(payload, "utf-8"),
        qos: 0 as const,
        retain: false,
        cmd: "publish" as const,
        dup: false,
      },
      (err?: Error | null) => {
        if (err) {
          const safeError = redactWebMqttError(err, currentConfig);
          stats.lastError = safeError;
          reject(new Error(safeError));
          return;
        }
        resolve();
      },
    );
  });
  stats.outboundMessages += 1;
  return delivered;
}

/**
 * 记录入站接受计数。
 */
export function trackInboundAccepted(): void {
  stats.acceptedMessages += 1;
}

/**
 * 记录入站丢弃计数。
 */
export function trackInboundDropped(reason: string): void {
  stats.droppedMessages += 1;
  // reason 可能来自第三方 dispatch 错误；状态端点是公开边界，必须再次统一脱敏。
  stats.lastError = redactWebMqttError(reason, currentConfig);
}

/**
 * 根据 clientId 获取认证用户名。
 */
export function getClientUsername(clientId: string): string | null {
  const client = connectedClients.get(clientId);
  return client ? clientUsernameMap.get(client) ?? null : null;
}

function bindBrokerEventHandlers(): void {
  // 连接计数：client 事件增、clientDisconnect 减并清理 username 映射
  broker!.on("client", (client: Client) => {
    pendingClients.delete(client);
    connectedClients.set(client.id, client);
    stats.connectedClients = connectedClients.size;
  });
  broker!.on("clientDisconnect", (client: Client) => {
    pendingClients.delete(client);
    if (connectedClients.get(client.id) !== client) return;
    connectedClients.delete(client.id);
    removeSessionContextsByClient(client.id);
    stats.connectedClients = connectedClients.size;
  });
  broker!.on("connectionError", (client: Client) => pendingClients.delete(client));
  broker!.on("unsubscribe", (topics: string[], client: Client) => {
    const subscriptions = clientSubscriptions.get(client);
    topics.forEach((topic) => subscriptions?.delete(topic));
  });
}

/**
 * 配置 Aedes authenticate / authorizeSubscribe / authorizePublish 守卫。
 */
function configureAuthGuards(config: WebMqttConfig, onInbound: InboundHandler): void {
  (broker as any).authenticate = (client: Client, username: Buffer | undefined, password: Buffer | undefined, done: (err: Error | null, success: boolean) => void) => {
    const usernameText = username?.toString("utf-8");
    const finish = (success: boolean, error: Error | null = null): void => {
      if (!success) {
        stats.authFailures += 1;
        stats.lastError = redactWebMqttError(error?.message ?? "authentication_failed", config);
      }
      done(error, success);
    };
    if (
      !connectedClients.has(client.id) &&
      connectedClients.size + pendingClients.size >= config.maxConnections
    ) {
      stats.rejectedConnections += 1;
      return finish(false, new Error("maximum_connections_reached"));
    }
    if (!config.auth.required) {
      clientUsernameMap.set(client, "anonymous");
      pendingClients.add(client);
      return finish(true);
    }
    if (config.auth.allowAnonymous && !usernameText) {
      clientUsernameMap.set(client, "anonymous");
      pendingClients.add(client);
      return finish(true);
    }
    if (!usernameText || !password) return finish(false);

    const user = config.auth.users.find((item) => item.username === usernameText);
    if (!user) return finish(false);

    const ok = verifyPasswordAdapted(user.password, user.passwordHash, user.hashAlgorithm, password);
    if (!ok) return finish(false);
    clientUsernameMap.set(client, usernameText);
    pendingClients.add(client);
    return finish(true);
  };

  broker!.authorizeSubscribe = (
    client: Client,
    sub: Subscription,
    done: (error: Error | null, subscription?: Subscription) => void,
  ) => {
    const subscriptions = clientSubscriptions.get(client) ?? new Set<string>();
    const overLimit = !subscriptions.has(sub.topic) && subscriptions.size >= config.limits.maxSubscriptionsPerClient;
    const allowed = !overLimit && allowTopicByUser(config, client, sub.topic, "subscribe");
    if (allowed) {
      subscriptions.add(sub.topic);
      clientSubscriptions.set(client, subscriptions);
    }
    if (!allowed) {
      stats.aclDenials += 1;
      stats.lastError = overLimit ? "subscription_limit_reached" : "subscribe_acl_denied";
    }
    // Aedes requires a null subscription (not an Error) to emit SUBACK QoS 128.
    // Returning an Error leaves MQTT.js waiting for a SUBACK and only emits clientError.
    done(null, allowed ? sub : undefined);
  };

  (broker as any).authorizePublish = (client: Client | null, packet: PublishPacket, done: (error?: Error | null) => void) => {
    if (!client) return done(null);
    if (packet.payload.length > config.limits.maxPayloadBytes) {
      trackInboundDropped("payload_too_large");
      return done(new Error("payload_too_large"));
    }
    const allowed = allowTopicByUser(config, client, packet.topic, "publish");
    if (!allowed) {
      stats.aclDenials += 1;
      trackInboundDropped("publish_acl_denied");
      return done(new Error("topic_forbidden"));
    }
    const queue = inboundQueue;
    if (!queue) return done(new Error("inbound_queue_not_ready"));
    const depth = queue.snapshot().keys[client.id]?.depth ?? 0;
    if (depth >= config.limits.maxPendingMessagesPerClient) {
      trackInboundDropped("inbound_queue_full");
      return done(new Error("inbound_queue_full"));
    }
    const event = {
      topic: packet.topic,
      payload: packet.payload as Buffer,
      clientId: client.id,
      messageId: packet.messageId == null ? undefined : String(packet.messageId),
    };
    void queue.enqueue(client.id, async () => onInbound(event)).then(
      (result) => {
        if (result && !result.accepted && result.reason !== "duplicate") {
          done(new Error(result.reason ?? "inbound_rejected"));
          return;
        }
        done(null);
      },
      (error) => done(error instanceof Error ? error : new Error(String(error))),
    );
  };
}

function countActiveSubscribers(topic: string): number {
  let count = 0;
  for (const client of connectedClients.values()) {
    const subscriptions = clientSubscriptions.get(client);
    if (subscriptions && [...subscriptions].some((pattern) => matchTopicShared(topic, pattern))) count += 1;
  }
  return count;
}

/**
 * 按 TLS 配置创建 HTTP 或 HTTPS 底层服务器。
 */
function createWebServer(config: WebMqttConfig): HttpServer | HttpsServer {
  if (!config.tls.enabled) return createHttpServer();
  const tlsOptions = {
    key: config.tls.keyFile ? readFileSync(config.tls.keyFile) : undefined,
    cert: config.tls.certFile ? readFileSync(config.tls.certFile) : undefined,
    ca: config.tls.caFile ? readFileSync(config.tls.caFile) : undefined,
    minVersion: config.tls.minVersion,
    requestCert: config.tls.requestCert,
    rejectUnauthorized: config.tls.rejectUnauthorized,
  };
  return createHttpsServer(tlsOptions);
}

/**
 * 将 WebSocket 双向流桥接为 Aedes 可消费的 Duplex（含 idle 超时 terminate）。
 */
function createDuplexFromWs(ws: WebSocket, idleTimeoutMs: number): Duplex {
  // ws 官方 Duplex 适配器会把 Node Stream 的 pause/drain 语义传递到底层 socket，
  // 避免手写 push/send 桥接在浏览器慢消费者场景下无界积压内存。
  const stream = createWebSocketStream(ws);

  let timer: NodeJS.Timeout | null = null;
  const bumpIdleTimer = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => ws.terminate(), idleTimeoutMs);
    timer.unref?.();
  };

  ws.on("message", bumpIdleTimer);
  ws.on("pong", bumpIdleTimer);
  ws.on("close", () => {
    if (timer) clearTimeout(timer);
  });
  ws.on("error", () => {
    if (timer) clearTimeout(timer);
  });
  bumpIdleTimer();
  return stream;
}

/** 浏览器 Origin 必须能规范化为配置中的精确 http/https Origin。 */
function isAllowedBrowserOrigin(origin: string, allowedOrigins: string[]): boolean {
  try {
    const parsed = new URL(origin);
    return parsed.origin === origin && allowedOrigins.includes(parsed.origin);
  } catch {
    return false;
  }
}

/**
 * 按用户 ACL 规则或 publishAllow/subscribeAllow 白名单校验 topic 权限。
 */
function allowTopicByUser(
  config: WebMqttConfig,
  client: Client | null,
  topic: string,
  mode: "publish" | "subscribe",
): boolean {
  if (!config.auth.required) return true;
  const username = client ? clientUsernameMap.get(client) : undefined;
  if (!username) return config.auth.allowAnonymous;
  const user = config.auth.users.find((item) => item.username === username);
  if (!user) return false;
  return isUserActionAllowed({
    user,
    action: mode,
    topic,
  });
}

/**
 * 适配层：将 web-mqtt 的密码校验参数格式转换为共享 verifyPassword。
 */
function verifyPasswordAdapted(
  plainPassword: string | undefined,
  passwordHash: string | undefined,
  algorithm: "sha256" | "sha512" | undefined,
  incoming: Buffer,
): boolean {
  const input = incoming.toString("utf-8");
  if (plainPassword) {
    return safeEqualBuffer(Buffer.from(plainPassword), incoming);
  }
  if (!passwordHash) return false;
  return verifyPasswordShared(input, undefined, passwordHash, algorithm ?? "sha256");
}

function resetStats(): void {
  stats.connectedClients = 0;
  stats.rejectedConnections = 0;
  stats.authFailures = 0;
  stats.aclDenials = 0;
  stats.acceptedMessages = 0;
  stats.droppedMessages = 0;
  stats.routedByBinding = 0;
  stats.routedByStandard = 0;
  stats.outboundMessages = 0;
  stats.inboundQueued = 0;
  stats.inboundActive = 0;
  stats.lastError = undefined;
  stats.brokerReady = false;
}
