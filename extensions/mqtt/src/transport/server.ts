/**
 * @module mqtt/transport/server
 *
 * MQTT Broker 管理模块
 * 基于 aedes 实现轻量级内嵌 MQTT Broker
 *
 * 职责：
 * - 启动/停止 MQTT TCP 和 TLS 服务
 * - 管理客户端连接生命周期
 * - 处理认证逻辑
 * - 发布出站消息到指定 Topic
 */

import { createServer, type Server as TcpServer } from "node:net";
import { readFileSync } from "node:fs";
import { createServer as createTlsServer, type Server as TlsServer } from "node:tls";
import { Aedes } from "aedes";
import type { Client, PublishPacket, Subscription } from "aedes";
import { Redis } from "ioredis";
import RedisPersistence from "aedes-persistence-redis";
import MongoDbPersistence from "aedes-persistence-mongodb";
import LevelPersistence from "aedes-persistence-level";
import { Level } from "level";
import type {
  MqttBrokerConfig,
  MqttClientInfo,
  MqttAuthConfig,
  MqttInboundMessage,
} from "../types.js";
import { logAuditEvent } from "./audit.js";
import { verifyPassword } from "@partme.ai/openclaw-message-sdk/transport";
import {
  createKeyedRunQueue,
  type KeyedRunQueue,
} from "@partme.ai/openclaw-message-sdk/queue";
import { isUserActionAllowed, aclTopicMatches } from "./acl.js";
import { validateBrokerConfig } from "../config.js";
import { redactMqttError } from "../shared/redact.js";
import {
  updateConnectionMetrics,
  updateMessageMetrics,
  updateDroppedMetrics,
  updateQos0Dropped,
  updateMessageLatency,
  updateAuthMetrics,
  updateAclDenials,
} from "../shared/metrics.js";

type AedesBroker = Aedes;
/** Aedes 实例 */
let aedesInstance: AedesBroker | null = null;

/** TCP 服务器 */
let tcpServer: TcpServer | null = null;
let tlsServer: TlsServer | null = null;
let activeBrokerConfig: MqttBrokerConfig | null = null;
const qos0InflightByClient = new Map<Client, number>();
let qos0DropCount = 0;

/** Redis clients */
let redisClient: Redis | null = null;
/** 同一 clientId 串行、不同客户端并行的 Agent 入站任务队列。 */
let inboundQueue: KeyedRunQueue | null = null;

/** 已连接的客户端映射表 */
const connectedClients = new Map<string, { client: Client; info: MqttClientInfo }>();
let clientUsers = new WeakMap<Client, string>();
const pendingClients = new Set<Client>();

/**
 * 启动 MQTT Broker
 * 配置中包含持久化设置（通过 MqttPersistenceConfig）
 *
 * @param config - Broker 配置（包含 persistence 配置）
 * @param onMessage - 收到客户端消息时的回调
 */
export async function startBroker(
  config: MqttBrokerConfig,
  onMessage: (message: MqttInboundMessage) => void | Promise<void>,
  onClientConnect?: (clientId: string) => void,
  onClientDisconnect?: (clientId: string) => void
): Promise<void> {
  if (aedesInstance || tcpServer || tlsServer || activeBrokerConfig) {
    throw new Error("MQTT broker is already running");
  }
  validateBrokerConfig(config);
  activeBrokerConfig = config;
  try {

    inboundQueue = createKeyedRunQueue({
      taskTimeoutMs: config.limits.inboundTaskTimeoutMs,
      onError: (error, clientId) => {
        logAuditEvent(config.audit, "error", "inbound_handler_failed", {
          clientId,
          error: redactMqttError(error, config),
        });
      },
    });

    // 创建持久化和集群配置（支持多种后端）
    let persistence: unknown = undefined;

    // 检查是否启用了持久化
    const persistenceEnabled = config.persistence?.enabled ?? false;
    const backend = config.persistence?.backend ?? "memory";

    // 根据后端类型创建相应的持久化
    if (persistenceEnabled) {
      switch (backend) {
        case "redis": {
          const redisConfig = config.persistence?.redis;
          const keyPrefix = redisConfig?.keyPrefix ?? "mqtt";

          // 创建 Redis 客户端
          const redisOptions = {
            host: redisConfig?.host || "localhost",
            port: redisConfig?.port || 6379,
            db: redisConfig?.db || 0,
            password: redisConfig?.password,
            retryStrategy: (times: number) => Math.min(times * 50, 2000),
            maxRetriesPerRequest: 3,
            keyPrefix: `${keyPrefix}:`,
          };
          redisClient = new Redis(redisOptions);
          await redisClient.ping();

          // 创建 Redis persistence
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          persistence = RedisPersistence({
            conn: redisClient,
            packetTTL: () => redisConfig?.packetTTL ?? redisConfig?.retainedTTL ?? 0,
          } as any);

          console.log(`[openclaw-mqtt] Redis persistence enabled (prefix: ${keyPrefix})`);
          break;
        }

        case "mongodb": {
          const mongoConfig = config.persistence?.mongodb;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          persistence = MongoDbPersistence({
            url: mongoConfig?.url || "mongodb://localhost:27017",
            database: mongoConfig?.dbName,
            collectionPrefix:
              mongoConfig?.collectionPrefix ?? mongoConfig?.collectionName,
          } as any);
          console.log(`[openclaw-mqtt] MongoDB persistence enabled`);
          break;
        }

        case "level": {
          const levelConfig = config.persistence?.level;
          const database = new Level(levelConfig?.path || "./data/aedes-leveldb");
          persistence = LevelPersistence(database);
          console.log(`[openclaw-mqtt] LevelDB persistence enabled`);
          break;
        }

        case "memory":
          // 使用默认的内存持久化，不需要额外配置
          console.log(`[openclaw-mqtt] In-memory persistence enabled`);
          break;
      }
    }

    aedesInstance = new Aedes({
      persistence,
    });

    aedesInstance.preConnect = (client, _packet, callback) => {
      callback(null, true);
    };

    // 配置认证、ACL 与发布前策略校验。
    setupAuthentication(aedesInstance, config.auth, onMessage);

    // 监听客户端连接事件
    aedesInstance.on("client", (client: Client) => {
      const clientId = client.id;
      pendingClients.delete(client);
      const isReplacement = connectedClients.has(clientId);
      const remoteAddress = (client.conn as { remoteAddress?: string } | undefined)?.remoteAddress;
      console.log(`[openclaw-mqtt] Client connected: ${clientId}`);
      onClientConnect?.(clientId);
      logAuditEvent(config.audit, "info", "client_connected", {
        clientId,
        remoteAddress,
      });
      updateConnectionMetrics(connectedClients.size + (isReplacement ? 0 : 1), isReplacement ? 0 : 1, 0);

      connectedClients.set(clientId, {
        client,
        info: {
          clientId,
          username: clientUsers.get(client),
          connectedAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
          remoteAddress,
        },
      });
    });

    // 监听客户端断开事件
    aedesInstance.on("clientDisconnect", (client: Client) => {
      const clientId = client.id;
      pendingClients.delete(client);
      console.log(`[openclaw-mqtt] Client disconnected: ${clientId}`);
      const current = connectedClients.get(clientId);
      qos0InflightByClient.delete(client);
      if (current?.client !== client) return;
      connectedClients.delete(clientId);
      logAuditEvent(config.audit, "info", "client_disconnected", { clientId });
      updateConnectionMetrics(connectedClients.size, 0, 1);
      onClientDisconnect?.(clientId);
    });

    aedesInstance.on("connectionError", (client: Client) => {
      pendingClients.delete(client);
    });

    // Aedes 1.x 将持久化 setup 与 Broker 就绪改为显式异步生命周期；必须先 listen()
    // 再开放 TCP/TLS 端口，否则客户端能建立 socket 却永远收不到 CONNACK。
    await aedesInstance.listen();

    const startTasks: Array<Promise<void>> = [];
    if (config.port > 0) {
      startTasks.push(
        new Promise<void>((res, rej) => {
          tcpServer = createServer(aedesInstance!.handle);
          tcpServer.listen(config.port, config.host ?? "127.0.0.1", () => {
            console.log(`[openclaw-mqtt] MQTT Broker listening on tcp://${config.host ?? "127.0.0.1"}:${config.port}`);
            res();
          });
          tcpServer.on("error", (err) => {
            console.error(`[openclaw-mqtt] TCP server error: ${redactMqttError(err, config)}`);
            rej(err);
          });
        }),
      );
    }

    if (config.tls.enabled) {
      startTasks.push(
        new Promise<void>((res, rej) => {
          try {
            if (!config.tls.certFile || !config.tls.keyFile) {
              throw new Error("TLS enabled but certFile/keyFile is missing");
            }
            const tlsOptions = {
              cert: readFileSync(config.tls.certFile),
              key: readFileSync(config.tls.keyFile),
              ca: config.tls.caFile ? readFileSync(config.tls.caFile) : undefined,
              requestCert: config.tls.requestCert ?? false,
              rejectUnauthorized: config.tls.rejectUnauthorized ?? false,
            };
            tlsServer = createTlsServer(tlsOptions, aedesInstance!.handle);
            tlsServer.listen(config.tls.port, config.host ?? "127.0.0.1", () => {
              console.log(`[openclaw-mqtt] MQTT TLS listening on tls://${config.host ?? "127.0.0.1"}:${config.tls.port}`);
              res();
            });
            tlsServer.on("error", (err) => {
              console.error(`[openclaw-mqtt] TLS server error: ${redactMqttError(err, config)}`);
              rej(err);
            });
          } catch (err) {
            rej(err);
          }
        }),
      );
    }

    await Promise.all(startTasks);
  } catch (error) {
    await stopBroker().catch(() => undefined);
    throw error;
  }
}

/**
 * 停止 MQTT Broker 并释放 TCP/TLS/Redis/Aedes 资源。
 *
 * @returns Broker 完全关闭后 resolve
 */
export async function stopBroker(): Promise<void> {
  const tcp = tcpServer;
  const tls = tlsServer;
  const redis = redisClient;
  const aedes = aedesInstance;
  const queue = inboundQueue;
  tcpServer = null;
  tlsServer = null;
  redisClient = null;
  aedesInstance = null;
  inboundQueue = null;

  // 先停用队列，避免关闭 Broker 的窗口期继续接收新的 Agent 任务；随后等待底层任务链
  // 真实结束，确保 Gateway stop 返回后不再残留 Agent dispatch 或迟到的 PUBACK 回调。
  queue?.deactivate();
  const drainQueue = queue?.drain() ?? Promise.resolve();

  // net.Server.close() 只是不再 accept，新旧 MQTT socket 不主动结束就会让 Gateway stop
  // 无限等待。先销毁已认证和认证中的连接，Aedes 会据此完成 clientDisconnect 清理。
  const closeClientSocket = (client: Client): void => {
    (client.conn as { destroy?: () => void } | undefined)?.destroy?.();
  };
  for (const { client } of connectedClients.values()) closeClientSocket(client);
  for (const client of pendingClients) closeClientSocket(client);

  const closeNetServer = (server: TcpServer | TlsServer | null): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  const closeAedes = new Promise<void>((resolve, reject) => {
    if (!aedes) return resolve();
    aedes.close((error?: Error) => (error ? reject(error) : resolve()));
  });
  // Redis persistence owns and disconnects the shared connection through Aedes.destroy().
  // Only close it directly when Aedes was never created (partial startup failure).
  const closeRedis = redis && !aedes ? redis.quit().then(() => undefined) : Promise.resolve();

  connectedClients.clear();
  clientUsers = new WeakMap<Client, string>();
  activeBrokerConfig = null;
  qos0InflightByClient.clear();
  qos0DropCount = 0;
  pendingClients.clear();

  const results = await Promise.allSettled([
    closeNetServer(tcp),
    closeNetServer(tls),
    closeAedes,
    closeRedis,
    drainQueue,
  ]);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure) throw failure.reason;
}

/**
 * 发布消息到指定 Topic（Agent 回复推送给设备）。
 *
 * @param topic - 目标 Topic
 * @param payload - 消息内容（UTF-8 字符串）
 * @param qos - QoS 级别（0 或 1）
 * @param retain - 是否保留消息
 * @returns 发布完成时 resolve；broker 未就绪、载荷超限或 Aedes 回调报错时 reject
 */
export async function publishMessage(
  topic: string,
  payload: string,
  qos: 0 | 1 = 0,
  retain = false,
): Promise<void> {
  if (!aedesInstance) {
    throw new Error("[openclaw-mqtt] Cannot publish — broker not running");
  }
  if (activeBrokerConfig && Buffer.byteLength(payload, "utf-8") > activeBrokerConfig.limits.maxPayloadBytes) {
    logAuditEvent(activeBrokerConfig.audit, "warn", "outbound_payload_dropped_oversized", {
      topic,
      bytes: Buffer.byteLength(payload, "utf-8"),
      maxPayloadBytes: activeBrokerConfig.limits.maxPayloadBytes,
    });
    throw new Error(
      `[openclaw-mqtt] Cannot publish — payload exceeds maxPayloadBytes(${activeBrokerConfig.limits.maxPayloadBytes})`,
    );
  }

  updateMessageMetrics(topic, qos, "outbound");

  await new Promise<void>((resolve, reject) => {
    aedesInstance!.publish(
      {
        topic,
        payload: Buffer.from(payload, "utf-8"),
        qos,
        retain,
        cmd: "publish",
        dup: false,
      },
      (err: Error | undefined) => {
        if (err) {
          console.error(redactMqttError(
            `[openclaw-mqtt] Publish error on topic ${topic}: ${err.message}`,
            activeBrokerConfig,
          ));
          logAuditEvent(activeBrokerConfig?.audit, "error", "outbound_publish_failed", {
            topic,
            error: redactMqttError(err, activeBrokerConfig),
          });
          reject(err);
          return;
        }
        resolve();
      },
    );
  });
}

/**
 * 获取所有已连接客户端信息快照。
 *
 * @returns 当前在线客户端列表
 */
export function getConnectedClients(): MqttClientInfo[] {
  return Array.from(connectedClients.values(), ({ info }) => ({ ...info }));
}

/**
 * 根据 clientId 获取认证用户名（ACL 与审计用）。
 *
 * @param clientId - MQTT clientId
 * @returns 用户名；未映射时为 undefined
 */
export function getClientUsername(clientId: string): string | undefined {
  return connectedClients.get(clientId)?.info.username;
}

/**
 * 获取当前 Broker 运行统计。
 *
 * @returns 连接数、运行状态、QoS0 丢弃与 inflight 客户端计数
 */
export function getBrokerStats(): {
  connectedClients: number;
  running: boolean;
  qos0Dropped: number;
  qos0InflightClients: number;
  inboundQueued: number;
  inboundActive: number;
} {
  const queueSnapshot = inboundQueue?.snapshot();
  return {
    connectedClients: connectedClients.size,
    running: aedesInstance !== null,
    qos0Dropped: qos0DropCount,
    qos0InflightClients: qos0InflightByClient.size,
    inboundQueued: queueSnapshot?.queuedCount ?? 0,
    inboundActive: queueSnapshot?.activeCount ?? 0,
  };
}

/**
 * 配置 MQTT 认证、Topic ACL 与入站背压。
 *
 * Aedes 会在 `authorizePublish` 回调成功后才确认客户端发布。这里把 Agent
 * 入站处理也纳入该回调，因此可以保证：同一 clientId 严格有序、队列满时
 * 明确拒绝、处理失败或超时时不会向上游伪装成成功。
 */
function setupAuthentication(
  aedes: AedesBroker,
  authConfig: MqttAuthConfig,
  onMessage: (message: MqttInboundMessage) => void | Promise<void>,
): void {
  const usersByName = new Map(
    authConfig.users.map((user) => [user.username, user] as const),
  );

  aedes.authenticate = (client, username, password, callback) => {
    const usernameStr = username?.toString();
    const passwordStr = password?.toString() ?? "";
    const willTopic = (client as { will?: { topic?: string } }).will?.topic;
    // 所有认证出口统一经过 finish，确保成功/失败指标不会因新增分支而漏记。
    const finish = (success: boolean): void => {
      updateAuthMetrics(success);
      callback(null, success);
    };

    if (
      !connectedClients.has(client.id) &&
      connectedClients.size + pendingClients.size >= (activeBrokerConfig?.maxConnections ?? 1_000)
    ) {
      logAuditEvent(activeBrokerConfig?.audit, "warn", "auth_failed_connection_limit", {
        clientId: client.id,
      });
      finish(false);
      return;
    }

    if (willTopic && !isWillAllowed(willTopic, activeBrokerConfig?.will.allow ?? true, activeBrokerConfig?.will.allowedTopicPatterns ?? [])) {
      logAuditEvent(activeBrokerConfig?.audit, "warn", "will_rejected_by_policy", {
        clientId: client.id,
        willTopic,
      });
      finish(false);
      return;
    }

    if (!authConfig.enabled) {
      pendingClients.add(client);
      finish(true);
      return;
    }

    if (!usernameStr) {
      if (authConfig.allowAnonymous) {
        const anonymousUser = usersByName.get("anonymous");
        if (!anonymousUser) {
          finish(false);
          return;
        }
        clientUsers.set(client, "anonymous");
        logAuditEvent(activeBrokerConfig?.audit, "info", "auth_success_anonymous", {
          clientId: client.id,
        });
        pendingClients.add(client);
        finish(true);
        return;
      }
      logAuditEvent(activeBrokerConfig?.audit, "warn", "auth_failed_missing_username", {
        clientId: client.id,
      });
      finish(false);
      return;
    }

    // 认证模式必须显式配置用户，禁止“有用户名即通过”。
    if (!authConfig.users.length) {
      logAuditEvent(activeBrokerConfig?.audit, "warn", "auth_failed_no_userlist", {
        clientId: client.id,
        username: usernameStr,
      });
      finish(false);
      return;
    }

    const user = usersByName.get(usernameStr);

    if (!user) {
      console.warn(`[openclaw-mqtt] Auth failed — unknown user: ${usernameStr}`);
      logAuditEvent(activeBrokerConfig?.audit, "warn", "auth_failed_unknown_user", {
        clientId: client.id,
        username: usernameStr,
      });
      finish(false);
      return;
    }

    if (!verifyPassword(passwordStr, user.password, user.passwordHash, user.hashAlgorithm)) {
      console.warn(`[openclaw-mqtt] Auth failed — bad password for: ${usernameStr}`);
      logAuditEvent(activeBrokerConfig?.audit, "warn", "auth_failed_bad_password", {
        clientId: client.id,
        username: usernameStr,
      });
      finish(false);
      return;
    }

    clientUsers.set(client, usernameStr);
    logAuditEvent(activeBrokerConfig?.audit, "info", "auth_success", {
      clientId: client.id,
      username: usernameStr,
    });
    pendingClients.add(client);
    finish(true);
  };

  // 企业级最小 ACL：按用户配置限制 publish/subscribe topic 范围
  aedes.authorizePublish = (
    client: Client | null,
    packet: PublishPacket,
    cb: (error?: Error | null) => void,
  ) => {
    if (!client) {
      cb(null);
      return;
    }
    if (packet.payload.length > (activeBrokerConfig?.limits.maxPayloadBytes ?? Number.MAX_SAFE_INTEGER)) {
      logAuditEvent(activeBrokerConfig?.audit, "warn", "inbound_payload_rejected_oversized", {
        clientId: client.id,
        topic: packet.topic,
        bytes: packet.payload.length,
        maxPayloadBytes: activeBrokerConfig?.limits.maxPayloadBytes,
      });
      updateDroppedMetrics("oversized");
      cb(new Error("payload exceeds maxPayloadBytes"));
      return;
    }
    if (packet.retain && activeBrokerConfig?.retain.allowInboundRetain === false) {
      logAuditEvent(activeBrokerConfig.audit, "warn", "inbound_retain_rejected", {
        clientId: client.id,
        topic: packet.topic,
      });
      cb(new Error("retained publish is disabled"));
      return;
    }
    if (!authConfig.enabled) {
      enqueueInboundMessage(client, packet, onMessage, cb);
      return;
    }
    const username = clientUsers.get(client);
    const user = usersByName.get(username ?? "");
    if (!user) {
      updateAclDenials("publish", packet.topic);
      cb(new Error("publish not allowed for unknown identity"));
      return;
    }
    const allowed = isUserActionAllowed({
      user,
      action: "publish",
      topic: packet.topic,
    });
    if (!allowed) {
      logAuditEvent(activeBrokerConfig?.audit, "warn", "acl_publish_denied", {
        clientId: client.id,
        username,
        topic: packet.topic,
      });
      updateAclDenials("publish", packet.topic);
    }
    if (!allowed) {
      cb(new Error("publish not allowed"));
      return;
    }
    enqueueInboundMessage(client, packet, onMessage, cb);
  };

  aedes.authorizeSubscribe = (client, sub: Subscription, cb) => {
    if (!client) {
      cb(null, sub);
      return;
    }
    if (!authConfig.enabled) {
      cb(null, sub);
      return;
    }
    const username = clientUsers.get(client);
    const user = usersByName.get(username ?? "");
    if (!user) {
      updateAclDenials("subscribe", sub.topic);
      cb(new Error("subscribe not allowed for unknown identity"), null);
      return;
    }
    const allowed = isUserActionAllowed({
      user,
      action: "subscribe",
      topic: sub.topic,
    });
    if (!allowed) {
      logAuditEvent(activeBrokerConfig?.audit, "warn", "acl_subscribe_denied", {
        clientId: client.id,
        username,
        topic: sub.topic,
      });
      updateAclDenials("subscribe", sub.topic);
    }
    cb(null, allowed ? sub : null);
  };
}

/**
 * 将一次客户端 Publish 纳入有界的按客户端串行队列。
 *
 * 队列 key 使用 clientId：同一设备的消息严格 FIFO，多个设备可并行处理。
 * QoS 0 没有协议级重投保证，因此额外应用较保守的 mailboxSoftLimit；QoS 1/2
 * 使用统一的 maxPendingMessagesPerClient。只有 Agent 入站回调完成后才通知
 * Aedes 接受本次发布，从而把失败和超时准确反馈给发布端。
 */
function enqueueInboundMessage(
  client: Client,
  packet: PublishPacket,
  onMessage: (message: MqttInboundMessage) => void | Promise<void>,
  callback: (error?: Error | null) => void,
): void {
  const config = activeBrokerConfig;
  const queue = inboundQueue;
  if (!config || !queue) {
    callback(new Error("inbound queue is not ready"));
    return;
  }

  const currentDepth = queue.snapshot().keys[client.id]?.depth ?? 0;
  const queueLimit = packet.qos === 0
    ? Math.min(config.limits.maxPendingMessagesPerClient, config.qos0.mailboxSoftLimit)
    : config.limits.maxPendingMessagesPerClient;
  if (currentDepth >= queueLimit) {
    qos0DropCount += packet.qos === 0 ? 1 : 0;
    if (packet.qos === 0) updateQos0Dropped();
    else updateDroppedMetrics("inbound_queue_full");
    logAuditEvent(config.audit, "warn", "inbound_queue_full", {
      clientId: client.id,
      topic: packet.topic,
      qos: packet.qos,
      depth: currentDepth,
      limit: queueLimit,
    });
    callback(new Error("inbound queue is full"));
    return;
  }

  const startedAt = Date.now();
  if (packet.qos === 0) incrementQos0Inflight(client);
  const connected = connectedClients.get(client.id);
  if (connected?.client === client) connected.info.lastActiveAt = new Date().toISOString();
  updateMessageMetrics(packet.topic, packet.qos, "inbound");

  const message: MqttInboundMessage = {
    topic: packet.topic,
    payload: packet.payload.toString("utf-8"),
    clientId: client.id,
    qos: packet.qos,
    retain: packet.retain,
    dup: packet.dup,
    messageId: packet.messageId,
    properties: packet.properties as Record<string, unknown> | undefined,
  };

  void queue.enqueue(client.id, async () => onMessage(message)).then(
    () => callback(null),
    (error) => callback(error instanceof Error ? error : new Error(String(error))),
  ).finally(() => {
    if (packet.qos === 0) decrementQos0Inflight(client);
    updateMessageLatency(Date.now() - startedAt);
  });
}

function isWillAllowed(topic: string, allow: boolean, patterns: string[]): boolean {
  if (!allow) return false;
  if (patterns.length === 0) return true;
  return patterns.some((pattern) => aclTopicMatches(topic, pattern));
}

function incrementQos0Inflight(client: Client): number {
  const next = (qos0InflightByClient.get(client) ?? 0) + 1;
  qos0InflightByClient.set(client, next);
  return next;
}

function decrementQos0Inflight(client: Client): void {
  const current = qos0InflightByClient.get(client) ?? 0;
  if (current <= 1) {
    qos0InflightByClient.delete(client);
    return;
  }
  qos0InflightByClient.set(client, current - 1);
}
