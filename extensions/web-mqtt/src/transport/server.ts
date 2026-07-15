/**
 * WebSocket MQTT 服务实现。
 * 内嵌 Aedes broker，提供企业级连接治理、基础鉴权与可观测统计。
 */

import { createBroker } from "aedes";
import type { Client, Subscription, PublishPacket } from "aedes";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { readFileSync } from "node:fs";
import { Duplex } from "node:stream";
import type { Socket } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import { verifyPassword as verifyPasswordShared, safeEqualBuffer, matchTopic as matchTopicShared } from "@partme.ai/openclaw-message-sdk/transport";
import { createKeyedRunQueue, type KeyedRunQueue } from "@partme.ai/openclaw-message-sdk";
import type { InboundHandler, WebMqttConfig, WebMqttServiceStats } from "../types.js";
import { isUserActionAllowed } from "./acl.js";
import { validateWebMqttConfig } from "../config.js";

type AedesBroker = NonNullable<ReturnType<typeof createBroker>>;

let broker: AedesBroker | null = null;
let server: HttpServer | HttpsServer | null = null;
let wss: InstanceType<typeof WebSocketServer> | null = null;
let currentConfig: WebMqttConfig | null = null;
let inboundQueue: KeyedRunQueue | null = null;
const clientUsernameMap = new Map<string, string>();
const pendingClients = new Set<string>();
const clientSubscriptions = new Map<string, Set<string>>();

const stats: WebMqttServiceStats = {
  connectedClients: 0,
  acceptedMessages: 0,
  droppedMessages: 0,
  routedByBinding: 0,
  routedByStandard: 0,
  outboundMessages: 0,
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
  inboundQueue = createKeyedRunQueue({
    onError: (error, clientId) => {
      trackInboundDropped(`inbound_dispatch_error:${String(error)}`);
      stats.lastError = `[${clientId}] ${String(error)}`;
    },
  });
  broker = createBroker({
    concurrency: config.maxConnections,
    heartbeatInterval: 30000,
  });
  broker.preConnect = (client, _packet, done) => {
    if (stats.connectedClients + pendingClients.size >= config.maxConnections) {
      done(new Error("maximum_connections_reached"), false);
      return;
    }
    pendingClients.add(client.id);
    done(null, true);
  };
  bindBrokerEventHandlers(config, onInbound);
  configureAuthGuards(config);

  server = createWebServer(config);
  wss = new WebSocketServer({
    server,
    path: config.path,
    perMessageDeflate: config.ws.compress,
    maxPayload: config.ws.maxFrameSize,
    clientTracking: true,
    verifyClient: (info, done) => {
      const origin = info.origin;
      if (wss && wss.clients.size >= config.maxConnections) {
        done(false, 503, "maximum connections reached");
        return;
      }
      if (origin && !config.ws.allowedOrigins.includes(origin)) {
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

  try {
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
    throw error;
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
  wss = null;
  server = null;
  broker = null;
  inboundQueue = null;
  currentConfig = null;
  queue?.deactivate();
  activeWss?.clients.forEach((client) => client.terminate());

  const closeWss = new Promise<void>((resolve) => {
    if (!activeWss) return resolve();
    activeWss.close(() => resolve());
  });
  const closeServer = new Promise<void>((resolve, reject) => {
    if (!activeServer) return resolve();
    activeServer.close((error) => (error ? reject(error) : resolve()));
  });
  const closeBroker = new Promise<void>((resolve, reject) => {
    if (!activeBroker) return resolve();
    activeBroker.close((error?: Error) => (error ? reject(error) : resolve()));
  });
  const results = await Promise.allSettled([closeWss, closeServer, closeBroker]);
  stats.connectedClients = 0;
  stats.brokerReady = false;
  clientUsernameMap.clear();
  clientSubscriptions.clear();
  pendingClients.clear();
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure) throw failure.reason;
}

/**
 * 获取状态。
 */
export function getStats(): WebMqttServiceStats {
  return { ...stats };
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
export async function publishToTopic(topic: string, payload: string): Promise<void> {
  if (!broker) {
    throw new Error("[openclaw-web-mqtt] Cannot publish — broker not running");
  }
  const payloadBytes = Buffer.byteLength(payload, "utf-8");
  if (currentConfig && payloadBytes > currentConfig.limits.maxPayloadBytes) {
    stats.lastError = "outbound_payload_too_large";
    throw new Error(
      `[openclaw-web-mqtt] Cannot publish — payload exceeds maxPayloadBytes(${currentConfig.limits.maxPayloadBytes})`,
    );
  }
  stats.outboundMessages += 1;
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
          stats.lastError = String(err);
          reject(err);
          return;
        }
        resolve();
      },
    );
  });
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
  stats.lastError = reason;
}

/**
 * 根据 clientId 获取认证用户名。
 */
export function getClientUsername(clientId: string): string | null {
  return clientUsernameMap.get(clientId) ?? null;
}

function bindBrokerEventHandlers(config: WebMqttConfig, onInbound: InboundHandler): void {
  // 连接计数：client 事件增、clientDisconnect 减并清理 username 映射
  broker!.on("client", (client: Client) => {
    pendingClients.delete(client.id);
    stats.connectedClients += 1;
  });
  broker!.on("clientDisconnect", (client: Client) => {
    stats.connectedClients = Math.max(0, stats.connectedClients - 1);
    clientUsernameMap.delete(client.id);
    clientSubscriptions.delete(client.id);
    pendingClients.delete(client.id);
  });
  broker!.on("connectionError", (client: Client) => pendingClients.delete(client.id));
  broker!.on("unsubscribe", (topics: string[], client: Client) => {
    const subscriptions = clientSubscriptions.get(client.id);
    topics.forEach((topic) => subscriptions?.delete(topic));
  });

  // 入站 publish：忽略 $SYS/ 与超 payload；转发给 OpenClaw inbound 管道
  broker!.on("publish", (packet: PublishPacket, client: Client | null) => {
    if (!client || packet.topic.startsWith("$SYS/")) return;
    if ((packet.payload as Buffer).length > config.limits.maxPayloadBytes) {
      trackInboundDropped("payload_too_large");
      return;
    }
    const event = {
      topic: packet.topic,
      payload: packet.payload as Buffer,
      clientId: client.id,
      messageId:
        packet.messageId !== undefined && packet.messageId !== null
          ? String(packet.messageId)
          : undefined,
    };
    const queue = inboundQueue;
    if (!queue) {
      trackInboundDropped("inbound_queue_not_ready");
      return;
    }
    void queue.enqueue(event.clientId, async () => {
      await onInbound(event);
    });
  });
}

/**
 * 配置 Aedes authenticate / authorizeSubscribe / authorizePublish 守卫。
 */
function configureAuthGuards(config: WebMqttConfig): void {
  (broker as any).authenticate = (client: Client, username: Buffer | undefined, password: Buffer | undefined, done: (err: Error | null, success: boolean) => void) => {
    const usernameText = username?.toString("utf-8");
    if (!config.auth.required) {
      clientUsernameMap.set(client.id, "anonymous");
      return done(null, true);
    }
    if (config.auth.allowAnonymous && !usernameText) {
      clientUsernameMap.set(client.id, "anonymous");
      return done(null, true);
    }
    if (!usernameText || !password) return done(new Error("missing_credentials"), false);

    const user = config.auth.users.find((item) => item.username === usernameText);
    if (!user) return done(new Error("invalid_credentials"), false);

    const ok = verifyPasswordAdapted(user.password, user.passwordHash, user.hashAlgorithm, password);
    if (!ok) return done(new Error("invalid_credentials"), false);
    clientUsernameMap.set(client.id, usernameText);
    return done(null, true);
  };

  broker!.authorizeSubscribe = (
    client: Client,
    sub: Subscription,
    done: (error: Error | null, subscription?: Subscription) => void,
  ) => {
    const subscriptions = clientSubscriptions.get(client.id) ?? new Set<string>();
    const overLimit = !subscriptions.has(sub.topic) && subscriptions.size >= config.limits.maxSubscriptionsPerClient;
    const allowed = !overLimit && allowTopicByUser(config, client, sub.topic, "subscribe");
    if (allowed) {
      subscriptions.add(sub.topic);
      clientSubscriptions.set(client.id, subscriptions);
    }
    // Aedes requires a null subscription (not an Error) to emit SUBACK QoS 128.
    // Returning an Error leaves MQTT.js waiting for a SUBACK and only emits clientError.
    done(null, allowed ? sub : undefined);
  };

  (broker as any).authorizePublish = (client: Client | null, packet: { topic: string }, done: (error?: Error | null) => void) => {
    if (!client) return done(null);
    const allowed = allowTopicByUser(config, client, packet.topic, "publish");
    done(allowed ? null : new Error("topic_forbidden"));
  };
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
  const stream = new Duplex({
    read() {},
    write(chunk: Buffer, _encoding, callback) {
      if (ws.readyState === ws.OPEN) ws.send(chunk, callback);
      else callback();
    },
    final(callback) {
      ws.close();
      callback();
    },
  });

  let timer: NodeJS.Timeout | null = null;
  const bumpIdleTimer = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => ws.terminate(), idleTimeoutMs);
  };

  ws.on("message", (data: Buffer) => {
    bumpIdleTimer();
    stream.push(data);
  });
  ws.on("pong", bumpIdleTimer);
  ws.on("close", () => {
    if (timer) clearTimeout(timer);
    stream.push(null);
    stream.destroy();
  });
  ws.on("error", (err: Error) => {
    if (timer) clearTimeout(timer);
    stream.destroy(err);
  });
  bumpIdleTimer();
  return stream;
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
  const username = client ? clientUsernameMap.get(client.id) : undefined;
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
  stats.acceptedMessages = 0;
  stats.droppedMessages = 0;
  stats.routedByBinding = 0;
  stats.routedByStandard = 0;
  stats.outboundMessages = 0;
  stats.lastError = undefined;
  stats.brokerReady = false;
}
