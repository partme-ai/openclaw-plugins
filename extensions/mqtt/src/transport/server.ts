/**
 * @module mqtt/transport/server
 *
 * MQTT Broker 管理模块
 * 基于 aedes 实现轻量级内嵌 MQTT Broker
 *
 * 职责：
 * - 启动/停止 MQTT TCP 和 WebSocket 服务
 * - 管理客户端连接生命周期
 * - 处理认证逻辑
 * - 发布出站消息到指定 Topic
 */

import { createServer, type Server as TcpServer } from "node:net";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer as createTlsServer, type Server as TlsServer } from "node:tls";
import { createBroker } from "aedes";
import type { Client, PublishPacket, Subscription } from "aedes";
import { Redis } from "ioredis";
import MQEmitterRedis from "mqemitter-redis";
import RedisPersistence from "aedes-persistence-redis";
import MongoDbPersistence from "aedes-persistence-mongodb";
import LevelPersistence from "aedes-persistence-level";
import NedbPersistence from "aedes-persistence-nedb";
import type {
  MqttBrokerConfig,
  MqttClientInfo,
  MqttAuthConfig,
  MqttInboundMessage,
} from "../types.js";
import { logAuditEvent } from "./audit.js";
import { isUserActionAllowed, aclTopicMatches } from "./acl.js";
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

/** Aedes 实例 */
let aedesInstance: AedesBroker | null = null;

/** TCP 服务器 */
let tcpServer: TcpServer | null = null;
let tlsServer: TlsServer | null = null;
let activeBrokerConfig: MqttBrokerConfig | null = null;
const qos0InflightByClient = new Map<string, number>();
let qos0DropCount = 0;

/** Redis clients */
let redisClient: Redis | null = null;
let mqEmitter: ReturnType<typeof MQEmitterRedis> | null = null;

/** 已连接的客户端映射表 */
const connectedClients = new Map<string, MqttClientInfo>();
const clientUsers = new Map<string, string>();

/**
 * 启动 MQTT Broker
 * 配置中包含持久化设置（通过 MqttPersistenceConfig）
 *
 * @param config - Broker 配置（包含 persistence 配置）
 * @param onMessage - 收到客户端消息时的回调
 */
export function startBroker(
  config: MqttBrokerConfig,
  onMessage: (message: MqttInboundMessage) => void,
  onClientConnect?: (clientId: string) => void,
  onClientDisconnect?: (clientId: string) => void
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    activeBrokerConfig = config;

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
          const subscriptionTTL = redisConfig?.subscriptionTTL ?? 3600;

          // 创建 Redis 客户端
          redisClient = new Redis({
            host: redisConfig?.host || "localhost",
            port: redisConfig?.port || 6379,
            db: redisConfig?.db || 0,
            password: redisConfig?.password,
            retryStrategy: (times: number) => Math.min(times * 50, 2000),
            maxRetriesPerRequest: 3,
          });

          // 创建 MQEmitter for clustering
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          mqEmitter = MQEmitterRedis({
            redis: redisClient,
          } as any);

          // 创建 Redis persistence
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          persistence = RedisPersistence({
            redis: redisClient,
            prefix: keyPrefix,
            ttl: {
              subscriptions: subscriptionTTL,
              packets: 0,
              messages: 0,
            },
          } as any);

          console.log(`[openclaw-mqtt] Redis persistence enabled (prefix: ${keyPrefix})`);
          break;
        }

        case "mongodb": {
          const mongoConfig = config.persistence?.mongodb;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          persistence = MongoDbPersistence({
            url: mongoConfig?.url || "mongodb://localhost:27017",
            collection: mongoConfig?.collectionName || "aedes",
          } as any);
          console.log(`[openclaw-mqtt] MongoDB persistence enabled`);
          break;
        }

        case "level": {
          const levelConfig = config.persistence?.level;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          persistence = LevelPersistence({
            path: levelConfig?.path || "./data/aedes-leveldb",
          } as any);
          console.log(`[openclaw-mqtt] LevelDB persistence enabled`);
          break;
        }

        case "nedb": {
          const nedbConfig = config.persistence?.nedb;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          persistence = NedbPersistence({
            folder: nedbConfig?.path || "./data/aedes-nedb",
          } as any);
          console.log(`[openclaw-mqtt] NeDB persistence enabled`);
          break;
        }

        case "memory":
        default:
          // 使用默认的内存持久化，不需要额外配置
          console.log(`[openclaw-mqtt] In-memory persistence enabled`);
          break;
      }
    }

    aedesInstance = createBroker({
      concurrency: config.maxConnections,
      persistence,
      mq: emitter,
    });

    // 配置认证
    if (config.auth.enabled) {
      setupAuthentication(aedesInstance, config.auth);
    }

    // 监听客户端连接事件
    aedesInstance.on("client", (client: Client) => {
      const clientId = client.id;
      const remoteAddress = (client.conn as { remoteAddress?: string } | undefined)?.remoteAddress;
      console.log(`[openclaw-mqtt] Client connected: ${clientId}`);
      onClientConnect?.(clientId);
      logAuditEvent(config.audit, "info", "client_connected", {
        clientId,
        remoteAddress,
      });
      updateConnectionMetrics(connectedClients.size + 1, 1, 0);

      connectedClients.set(clientId, {
        clientId,
        username: clientUsers.get(clientId),
        connectedAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        remoteAddress,
      });
    });

    // 监听客户端断开事件
    aedesInstance.on("clientDisconnect", (client: Client) => {
      const clientId = client.id;
      console.log(`[openclaw-mqtt] Client disconnected: ${clientId}`);
      connectedClients.delete(clientId);
      clientUsers.delete(clientId);
      qos0InflightByClient.delete(clientId);
      logAuditEvent(config.audit, "info", "client_disconnected", { clientId });
      updateConnectionMetrics(connectedClients.size, 0, 1);
      onClientDisconnect?.(clientId);
    });

    // 监听收到的消息（publish 事件）
    aedesInstance.on("publish", (packet: PublishPacket, client: Client | null) => {
      // 过滤系统 topic（$SYS）和无客户端的消息（如 retain）
      if (!client || packet.topic.startsWith("$SYS")) return;

      const clientId = client.id;

      // 更新客户端最后活跃时间
      const info = connectedClients.get(clientId);
      if (info) {
        info.lastActiveAt = new Date().toISOString();
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
        const inflight = incrementQos0Inflight(clientId);
        if (inflight > config.qos0.mailboxSoftLimit) {
          qos0DropCount += 1;
          decrementQos0Inflight(clientId);
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

      const maybePromise = onMessage({
        topic: packet.topic,
        payload: packet.payload.toString("utf-8"),
        clientId,
        qos: packet.qos,
        retain: packet.retain,
        dup: packet.dup,
        messageId: packet.messageId,
        properties: packet.properties as Record<string, unknown> | undefined,
      });
      if (packet.qos === 0) {
        void Promise.resolve(maybePromise).finally(() => {
          decrementQos0Inflight(clientId);
        });
      }
    });

    const startTasks: Array<Promise<void>> = [];
    if (config.port > 0) {
      startTasks.push(
        new Promise<void>((res, rej) => {
          tcpServer = createServer(aedesInstance!.handle);
          tcpServer.listen(config.port, () => {
            console.log(`[openclaw-mqtt] MQTT Broker listening on tcp://0.0.0.0:${config.port}`);
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
            tlsServer.listen(config.tls.port, () => {
              console.log(`[openclaw-mqtt] MQTT TLS listening on tls://0.0.0.0:${config.tls.port}`);
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

    Promise.all(startTasks).then(() => resolve()).catch((err) => reject(err));
  });
}

/**
 * 停止 MQTT Broker 并释放 TCP/TLS/Redis/Aedes 资源。
 *
 * @returns Broker 完全关闭后 resolve
 */
export async function stopBroker(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (tcpServer) {
      tcpServer.close(() => {
        console.log("[openclaw-mqtt] TCP server closed");
      });
      tcpServer = null;
    }

    if (tlsServer) {
      tlsServer.close(() => {
        console.log("[openclaw-mqtt] TLS server closed");
      });
      tlsServer = null;
    }

    // 关闭 Redis 连接
    if (redisClient) {
      redisClient.quit().then(() => {
        console.log("[openclaw-mqtt] Redis client closed");
      });
      redisClient = null;
    }
    mqEmitter = null;

    if (aedesInstance) {
      aedesInstance.close(() => {
        console.log("[openclaw-mqtt] Aedes broker closed");
        resolve();
      });
      aedesInstance = null;
    } else {
      resolve();
    }

    connectedClients.clear();
    clientUsers.clear();
    activeBrokerConfig = null;
    qos0InflightByClient.clear();
    qos0DropCount = 0;
  });
}

/**
 * 发布消息到指定 Topic（Agent 回复推送给设备）。
 *
 * @param topic - 目标 Topic
 * @param payload - 消息内容（UTF-8 字符串）
 * @param qos - QoS 级别（0 或 1）
 * @param retain - 是否保留消息
 */
export function publishMessage(
  topic: string,
  payload: string,
  qos: 0 | 1 = 0,
  retain = false
): void {
  if (!aedesInstance) {
    console.warn("[openclaw-mqtt] Cannot publish — broker not running");
    return;
  }
  if (activeBrokerConfig && Buffer.byteLength(payload, "utf-8") > activeBrokerConfig.limits.maxPayloadBytes) {
    console.warn(
      `[openclaw-mqtt] Cannot publish — payload exceeds maxPayloadBytes(${activeBrokerConfig.limits.maxPayloadBytes})`,
    );
    logAuditEvent(activeBrokerConfig.audit, "warn", "outbound_payload_dropped_oversized", {
      topic,
      bytes: Buffer.byteLength(payload, "utf-8"),
      maxPayloadBytes: activeBrokerConfig.limits.maxPayloadBytes,
    });
    return;
  }

  // Track outbound message
  updateMessageMetrics(topic, qos, "outbound");

  aedesInstance.publish(
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
      }
    }
  );
}

/**
 * 获取所有已连接客户端信息快照。
 *
 * @returns 当前在线客户端列表
 */
export function getConnectedClients(): MqttClientInfo[] {
  return Array.from(connectedClients.values());
}

/**
 * 根据 clientId 获取认证用户名（ACL 与审计用）。
 *
 * @param clientId - MQTT clientId
 * @returns 用户名；未映射时为 undefined
 */
export function getClientUsername(clientId: string): string | undefined {
  return clientUsers.get(clientId);
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

    if (willTopic && !isWillAllowed(willTopic, activeBrokerConfig?.will.allow ?? true, activeBrokerConfig?.will.allowedTopicPatterns ?? [])) {
      logAuditEvent(activeBrokerConfig?.audit, "warn", "will_rejected_by_policy", {
        clientId: client.id,
        willTopic,
      });
      callback(null, false);
      return;
    }

    if (!usernameStr) {
      if (authConfig.allowAnonymous) {
        clientUsers.set(client.id, "anonymous");
        logAuditEvent(activeBrokerConfig?.audit, "info", "auth_success_anonymous", {
          clientId: client.id,
        });
        callback(null, true);
        return;
      }
      logAuditEvent(activeBrokerConfig?.audit, "warn", "auth_failed_missing_username", {
        clientId: client.id,
      });
      callback(null, false);
      return;
    }

    // 如果没有配置用户列表则允许所有连接
    if (!authConfig.users.length) {
      clientUsers.set(client.id, usernameStr);
      logAuditEvent(activeBrokerConfig?.audit, "info", "auth_success_no_userlist", {
        clientId: client.id,
        username: usernameStr,
      });
      callback(null, true);
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

    clientUsers.set(client.id, usernameStr);
    logAuditEvent(activeBrokerConfig?.audit, "info", "auth_success", {
      clientId: client.id,
      username: usernameStr,
    });
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
    const user = usersByName.get(clientUsers.get(client.id) ?? "");
    if (!user) {
      cb(null);
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
        username: clientUsers.get(client.id),
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
    const user = usersByName.get(clientUsers.get(client.id) ?? "");
    if (!user) {
      cb(null, sub);
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
        username: clientUsers.get(client.id),
        topic: sub.topic,
      });
      updateAclDenials("subscribe", sub.topic);
    }
    cb(null, allowed ? sub : null);
  };
}

function verifyPassword(
  plain: string,
  expectedPlain?: string,
  expectedHash?: string,
  algorithm: "sha256" | "sha512" = "sha256",
): boolean {
  if (typeof expectedPlain === "string") {
    return expectedPlain === plain;
  }
  if (typeof expectedHash !== "string") {
    return false;
  }
  const actualHex = createHash(algorithm).update(plain, "utf-8").digest("hex");
  const actualBuf = Buffer.from(actualHex, "hex");
  const expectedBuf = Buffer.from(expectedHash, "hex");
  if (actualBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(actualBuf, expectedBuf);
}

function isWillAllowed(topic: string, allow: boolean, patterns: string[]): boolean {
  if (!allow) return false;
  if (patterns.length === 0) return true;
  return patterns.some((pattern) => aclTopicMatches(topic, pattern));
}

function incrementQos0Inflight(clientId: string): number {
  const next = (qos0InflightByClient.get(clientId) ?? 0) + 1;
  qos0InflightByClient.set(clientId, next);
  return next;
}

function decrementQos0Inflight(clientId: string): void {
  const current = qos0InflightByClient.get(clientId) ?? 0;
  if (current <= 1) {
    qos0InflightByClient.delete(clientId);
    return;
  }
  qos0InflightByClient.set(clientId, current - 1);
}
