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
import { createHash, timingSafeEqual } from "node:crypto";
import type { InboundHandler, WebMqttConfig, WebMqttServiceStats } from "../types.js";
import { isUserActionAllowed } from "./acl.js";

type AedesBroker = NonNullable<ReturnType<typeof createBroker>>;

let broker: AedesBroker | null = null;
let server: HttpServer | HttpsServer | null = null;
let wss: InstanceType<typeof WebSocketServer> | null = null;
let currentConfig: WebMqttConfig | null = null;
const clientUsernameMap = new Map<string, string>();

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
  currentConfig = config;
  broker = createBroker({
    concurrency: 100,
    heartbeatInterval: 30000,
  });
  bindBrokerEventHandlers(config, onInbound);
  configureAuthGuards(config);

  server = createWebServer(config);
  wss = new WebSocketServer({
    server,
    path: config.path,
    perMessageDeflate: config.ws.compress,
    maxPayload: config.ws.maxFrameSize,
    clientTracking: true,
  });

  wss.on("connection", (ws) => {
    const stream = createDuplexFromWs(ws, config.ws.idleTimeoutMs);
    broker!.handle(stream as unknown as Socket);
  });

  await new Promise<void>((resolve, reject) => {
    server!.listen(config.port, config.host, () => resolve());
    server!.on("error", reject);
  });
  stats.brokerReady = true;
}

/**
 * 停止服务。
 */
export async function stopWebMqttServer(): Promise<void> {
  if (wss) {
    wss.close();
    wss = null;
  }
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
  if (broker) {
    await new Promise<void>((resolve) => broker!.close(() => resolve()));
    broker = null;
  }
  stats.connectedClients = 0;
  stats.brokerReady = false;
  clientUsernameMap.clear();
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
 */
export function publishToTopic(topic: string, payload: string): void {
  if (!broker) return;
  stats.outboundMessages += 1;
  broker.publish(
    {
      topic,
      payload: Buffer.from(payload, "utf-8"),
      qos: 0 as const,
      retain: false,
      cmd: "publish" as const,
      dup: false,
    },
    (err?: Error | null) => {
      if (err) stats.lastError = String(err);
    },
  );
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
  broker!.on("client", () => {
    stats.connectedClients += 1;
  });
  broker!.on("clientDisconnect", (client: Client) => {
    stats.connectedClients = Math.max(0, stats.connectedClients - 1);
    clientUsernameMap.delete(client.id);
  });

  broker!.on("publish", (packet: PublishPacket, client: Client | null) => {
    if (!client || packet.topic.startsWith("$SYS/")) return;
    if ((packet.payload as Buffer).length > config.limits.maxPayloadBytes) {
      trackInboundDropped("payload_too_large");
      return;
    }
    onInbound({
      topic: packet.topic,
      payload: packet.payload as Buffer,
      clientId: client.id,
      messageId:
        packet.messageId !== undefined && packet.messageId !== null
          ? String(packet.messageId)
          : undefined,
    });
  });
}

function configureAuthGuards(config: WebMqttConfig): void {
  (broker as any).authenticate = (client: Client, username: string | undefined, password: Buffer | undefined, done: (err: Error | null, success: boolean) => void) => {
    if (!config.auth.required) return done(null, true);
    if (config.auth.allowAnonymous && !username) return done(null, true);
    if (!username || !password) return done(new Error("missing_credentials"), false);

    const user = config.auth.users.find((item) => item.username === username);
    if (!user) return done(new Error("invalid_credentials"), false);

    const ok = verifyPassword(user.password, user.passwordHash, user.hashAlgorithm, password);
    if (!ok) return done(new Error("invalid_credentials"), false);
    clientUsernameMap.set(client.id, username);
    return done(null, true);
  };

  broker!.authorizeSubscribe = (
    client: Client,
    sub: Subscription,
    done: (error: Error | null, subscription?: Subscription) => void,
  ) => {
    const allowed = allowTopicByUser(config, client, sub.topic, "subscribe");
    done(allowed ? null : new Error("topic_forbidden"), sub);
  };

  (broker as any).authorizePublish = (client: Client | null, packet: { topic: string }, done: (error?: Error | null) => void) => {
    const allowed = allowTopicByUser(config, client, packet.topic, "publish");
    done(allowed ? null : new Error("topic_forbidden"));
  };
}

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

function allowTopicByUser(
  config: WebMqttConfig,
  client: Client | null,
  topic: string,
  mode: "publish" | "subscribe",
): boolean {
  if (!config.auth.required) return true;
  const username = (client as Client & { conn?: { username?: string } })?.conn?.username;
  if (!username) return config.auth.allowAnonymous;
  const user = config.auth.users.find((item) => item.username === username);
  if (!user) return false;
  return isUserActionAllowed({
    user,
    action: mode,
    topic,
  });
}

function verifyPassword(
  plainPassword: string | undefined,
  passwordHash: string | undefined,
  algorithm: "sha256" | "sha512" | undefined,
  incoming: Buffer,
): boolean {
  if (plainPassword) {
    return safeEqual(Buffer.from(plainPassword), incoming);
  }
  if (!passwordHash) return false;
  const hashName = algorithm ?? "sha256";
  const digest = createHash(hashName).update(incoming).digest("hex");
  return safeEqual(Buffer.from(passwordHash), Buffer.from(digest));
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
