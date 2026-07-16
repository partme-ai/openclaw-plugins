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
import { createBroker } from "aedes";
import type { Client, PublishPacket, Subscription } from "aedes";
import { Redis } from "ioredis";
import type { RedisOptions } from "ioredis";
import MQEmitterRedis from "mqemitter-redis";
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
import { verifyPassword, matchTopic as matchTopicShared } from "@partme.ai/openclaw-message-sdk/transport";
import { isUserActionAllowed, aclTopicMatches } from "./acl.js";
import { validateBrokerConfig } from "../config.js";
import {
  updateConnectionMetrics,
  updateMessageMetrics,
  updateDroppedMetrics,
  updateQos0Dropped,
  updateMessageLatency,
  updateAuthMetrics,
  updateAclDenials,
  updateSessionMetrics,
} from "../shared/metrics.js";

type AedesBroker = NonNullable<ReturnType<typeof createBroker>>;
type MQEmitterRedisFactory = {
  (options?: RedisOptions): unknown;
  MQEmitterRedisPrefix: new (
    prefix: string,
    options?: RedisOptions,
  ) => unknown;
};

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
let mqEmitter: unknown = null;

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

    // 创建持久化和集群配置（支持多种后端）
    let persistence: unknown = undefined;
    let emitter: unknown = undefined;

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

          // mqemitter-redis owns two dedicated Pub/Sub connections. Its API accepts
          // ioredis options directly (not an existing `redis` client). Prefixing
          // topics isolates independent OpenClaw clusters sharing one Redis.
          const PrefixEmitter = (MQEmitterRedis as unknown as MQEmitterRedisFactory).MQEmitterRedisPrefix;
          mqEmitter = new PrefixEmitter(`${keyPrefix}:mq:`, redisOptions);
          emitter = mqEmitter;

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

    aedesInstance = createBroker({
      persistence,
      mq: emitter,
    });

    aedesInstance.preConnect = (client, _packet, callback) => {
      callback(null, true);
    };

    // 配置认证、ACL 与发布前策略校验。
    setupAuthentication(aedesInstance, config.auth);

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

    // 监听收到的消息（publish 事件）
    aedesInstance.on("publish", (packet: PublishPacket, client: Client | null) => {
      // 过滤系统 topic（$SYS）和无客户端的消息（如 retain）
      if (!client || packet.topic.startsWith("$SYS")) return;

      const clientId = client.id;

      // 更新客户端最后活跃时间
      const current = connectedClients.get(clientId);
      if (current?.client === client) {
        current.info.lastActiveAt = new Date().toISOString();
      }

      // 传递 MQTT 特定属性给上层处理
      if (packet.payload.length > config.limits.maxPayloadBytes) {
        console.warn(
          `[openclaw-mqtt] Dropped oversized payload from ${clientId}: ${packet.payload.length} bytes > ${config.limits.maxPayloadBytes}`,
        );
        logAuditEvent(config.audit, "warn", "inbound_payload_dropped_oversized", {
          clientId,
          topic: packet.topic,
          bytes: packet.payload.length,
          maxPayloadBytes: config.limits.maxPayloadBytes,
        });
        updateDroppedMetrics("oversized");
        return;
      }
      if (packet.qos === 0) {
        const inflight = incrementQos0Inflight(client);
        if (inflight > config.qos0.mailboxSoftLimit) {
          qos0DropCount += 1;
          decrementQos0Inflight(client);
          console.warn(
            `[openclaw-mqtt] QoS0 dropped for ${clientId}: inflight=${inflight}, softLimit=${config.qos0.mailboxSoftLimit}`,
          );
          logAuditEvent(config.audit, "warn", "inbound_qos0_dropped_soft_limit", {
            clientId,
            topic: packet.topic,
            inflight,
            softLimit: config.qos0.mailboxSoftLimit,
          });
          updateQos0Dropped();
          return;
        }
      }

      // Track incoming message
      updateMessageMetrics(packet.topic, packet.qos, "inbound");

      void Promise.resolve().then(() => onMessage({
          topic: packet.topic,
          payload: packet.payload.toString("utf-8"),
          clientId,
          qos: packet.qos,
          retain: packet.retain,
          dup: packet.dup,
          messageId: packet.messageId,
          properties: packet.properties as Record<string, unknown> | undefined,
        }))
        .catch((error: unknown) => {
          console.error(`[openclaw-mqtt] Inbound handler failed for ${clientId}:`, error);
          logAuditEvent(config.audit, "error", "inbound_handler_failed", {
            clientId,
            topic: packet.topic,
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          if (packet.qos === 0) decrementQos0Inflight(client);
        });
    });

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
            console.error("[openclaw-mqtt] TCP server error:", err);
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
              console.error("[openclaw-mqtt] TLS server error:", err);
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
  tcpServer = null;
  tlsServer = null;
  redisClient = null;
  aedesInstance = null;
  mqEmitter = null;

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
          console.error(`[openclaw-mqtt] Publish error on topic ${topic}:`, err);
          logAuditEvent(activeBrokerConfig?.audit, "error", "outbound_publish_failed", {
            topic,
            error: String(err),
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
} {
  return {
    connectedClients: connectedClients.size,
    running: aedesInstance !== null,
    qos0Dropped: qos0DropCount,
    qos0InflightClients: qos0InflightByClient.size,
  };
}

/**
 * 配置 MQTT 认证
 * 验证客户端 username/password
 */
function setupAuthentication(aedes: AedesBroker, authConfig: MqttAuthConfig): void {
  const usersByName = new Map(
    authConfig.users.map((user) => [user.username, user] as const),
  );

  aedes.authenticate = (client, username, password, callback) => {
    const usernameStr = username?.toString();
    const passwordStr = password?.toString() ?? "";
    const willTopic = (client as { will?: { topic?: string } }).will?.topic;

    if (
      !connectedClients.has(client.id) &&
      connectedClients.size + pendingClients.size >= (activeBrokerConfig?.maxConnections ?? 1_000)
    ) {
      logAuditEvent(activeBrokerConfig?.audit, "warn", "auth_failed_connection_limit", {
        clientId: client.id,
      });
      callback(null, false);
      return;
    }

    if (willTopic && !isWillAllowed(willTopic, activeBrokerConfig?.will.allow ?? true, activeBrokerConfig?.will.allowedTopicPatterns ?? [])) {
      logAuditEvent(activeBrokerConfig?.audit, "warn", "will_rejected_by_policy", {
        clientId: client.id,
        willTopic,
      });
      callback(null, false);
      return;
    }

    if (!authConfig.enabled) {
      pendingClients.add(client);
      callback(null, true);
      return;
    }

    if (!usernameStr) {
      if (authConfig.allowAnonymous) {
        const anonymousUser = usersByName.get("anonymous");
        if (!anonymousUser) {
          callback(null, false);
          return;
        }
        clientUsers.set(client, "anonymous");
        logAuditEvent(activeBrokerConfig?.audit, "info", "auth_success_anonymous", {
          clientId: client.id,
        });
        pendingClients.add(client);
        callback(null, true);
        return;
      }
      logAuditEvent(activeBrokerConfig?.audit, "warn", "auth_failed_missing_username", {
        clientId: client.id,
      });
      callback(null, false);
      return;
    }

    // 认证模式必须显式配置用户，禁止“有用户名即通过”。
    if (!authConfig.users.length) {
      logAuditEvent(activeBrokerConfig?.audit, "warn", "auth_failed_no_userlist", {
        clientId: client.id,
        username: usernameStr,
      });
      callback(null, false);
      return;
    }

    const user = usersByName.get(usernameStr);

    if (!user) {
      console.warn(`[openclaw-mqtt] Auth failed — unknown user: ${usernameStr}`);
      logAuditEvent(activeBrokerConfig?.audit, "warn", "auth_failed_unknown_user", {
        clientId: client.id,
        username: usernameStr,
      });
      callback(null, false);
      return;
    }

    if (!verifyPassword(passwordStr, user.password, user.passwordHash, user.hashAlgorithm)) {
      console.warn(`[openclaw-mqtt] Auth failed — bad password for: ${usernameStr}`);
      logAuditEvent(activeBrokerConfig?.audit, "warn", "auth_failed_bad_password", {
        clientId: client.id,
        username: usernameStr,
      });
      callback(null, false);
      return;
    }

    clientUsers.set(client, usernameStr);
    logAuditEvent(activeBrokerConfig?.audit, "info", "auth_success", {
      clientId: client.id,
      username: usernameStr,
    });
    pendingClients.add(client);
    callback(null, true);
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
      cb(null);
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
    cb(allowed ? null : new Error("publish not allowed"));
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
