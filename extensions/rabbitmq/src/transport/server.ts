/**
 * @fileoverview RabbitMQ 传输层：amqplib 连接、Exchange/Queue 声明与消费发布。
 *
 * @description
 * 负责 Broker 生命周期、重连、重试队列、入站 ACK/NACK 处置与出站发布；
 * 由 `channel.gateway.startAccount` 注入 `processInbound` 作为消费回调。
 *
 * @module transport/server
 */

import amqp from "amqplib";
import { randomUUID } from "node:crypto";
import type { ConsumeMessage, ChannelModel, Channel, Options } from "amqplib";
import type { RabbitmqConfig } from "../config.js";

/** @description 入站 AMQP 消息事件（routingKey + 原始 body + 属性）。 */
export type InboundEvent = {
  routingKey: string;
  content: Buffer;
  properties: ConsumeMessage["properties"];
  fields: ConsumeMessage["fields"];
};

/** @description 消费端对单条消息的处置结果（ACK / NACK / 重入队）。 */
export type InboundDisposition =
  | { ok: true }
  | { ok: false; requeue?: boolean; reason?: string };

/** @description 入站消息回调：由 channel.gateway 注入 processInbound。 */
export type InboundHandler = (event: InboundEvent) => Promise<InboundDisposition>;

/** @description RabbitMQ 连接与消息吞吐运行时统计快照。 */
export type RabbitmqStats = {
  connected: boolean;
  lastConnectAt: number | null;
  lastDisconnectAt: number | null;
  lastConsumeAt: number | null;
  lastError: string | null;
  messagesReceived: number;
  messagesSent: number;
  messagesAcked: number;
  messagesNacked: number;
  messagesRequeued: number;
  errors: number;
  inFlight: number;
};

let connection: ChannelModel | null = null;
let consumeChannel: Channel | null = null;
let publishChannel: Channel | null = null;
let consumerTag: string | null = null;
let inboundHandler: InboundHandler | null = null;
let config: RabbitmqConfig | null = null;
let stopping = false;
let retryQueueName: string | null = null;
let retryRoutingPrefix: string | null = null;
let inboundLimiter: ReturnType<typeof createInboundLimiter> | null = null;
let stats: RabbitmqStats = {
  connected: false,
  lastConnectAt: null,
  lastDisconnectAt: null,
  lastConsumeAt: null,
  lastError: null,
  messagesReceived: 0,
  messagesSent: 0,
  messagesAcked: 0,
  messagesNacked: 0,
  messagesRequeued: 0,
  errors: 0,
  inFlight: 0,
};

/**
 * @description 启动 RabbitMQ 服务：建立连接、声明 Exchange/Queue、绑定订阅并开始消费。
 * @param cfg - 已解析的 RabbitMQ 通道配置
 * @param handler - 入站消息处理器（通常为 processInbound）
 */
export async function startRabbitmqServer(cfg: RabbitmqConfig, handler: InboundHandler): Promise<void> {
  config = cfg;
  inboundHandler = handler;
  stopping = false;
  await connectWithRetry();
}

/**
 * @description 优雅关闭 RabbitMQ：取消消费、关闭 channel 与 connection。
 */
export async function stopRabbitmqServer(): Promise<void> {
  stopping = true;
  inboundLimiter = null;
  retryRoutingPrefix = null;
  retryQueueName = null;
  try {
    if (consumeChannel && consumerTag) {
      await consumeChannel.cancel(consumerTag);
    }
  } catch {
  } finally {
    consumerTag = null;
  }
  try {
    if (consumeChannel) {
      await consumeChannel.close();
    }
  } catch {
  } finally {
    consumeChannel = null;
  }
  try {
    if (publishChannel) {
      await publishChannel.close();
    }
  } catch {
  } finally {
    publishChannel = null;
  }
  try {
    if (connection) {
      await connection.close();
    }
  } catch {
  } finally {
    connection = null;
  }
  stats.connected = false;
  stats.lastDisconnectAt = Date.now();
}

/**
 * @description 向 Exchange 发布一条消息（出站 / Agent 回复）。
 * @param routingKey - AMQP routing key（Topic）
 * @param message - 消息体（通常为 JSON 或纯文本）
 * @param opts - 可选持久化、自定义 headers、correlationId
 */
export async function publishMessage(routingKey: string, message: string, opts?: { persistent?: boolean; headers?: Record<string, unknown>; correlationId?: string }): Promise<void> {
  if (!publishChannel || !config) {
    throw new Error("RabbitMQ publish channel not initialized");
  }
  const options: Options.Publish = {
    persistent: opts?.persistent === true,
    correlationId: opts?.correlationId,
    headers: opts?.headers,
    contentType: "application/json",
  };
  publishChannel.publish(config.exchange, routingKey, Buffer.from(message), options);
  stats.messagesSent++;
}

/**
 * @description RPC 风格请求：向指定队列发送消息并等待 reply-to 队列响应。
 * @param params.queue - 目标队列名
 * @param params.payload - 请求体
 * @param params.timeoutMs - 等待响应超时（毫秒）
 * @returns correlationId 与响应 payload
 */
export async function requestMessage(params: {
  queue: string;
  payload: string;
  timeoutMs: number;
  correlationId?: string;
}): Promise<{ correlationId: string; payload: string }> {
  if (!connection) {
    throw new Error("RabbitMQ connection not initialized");
  }
  const ch = await connection.createChannel();
  const correlationId = params.correlationId ?? randomUUID();
  try {
    const result = await new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("mq.request timeout")), params.timeoutMs);
      ch.consume(
        "amq.rabbitmq.reply-to",
        (msg: ConsumeMessage | null) => {
          if (!msg) return;
          if (msg.properties.correlationId !== correlationId) {
            return;
          }
          clearTimeout(t);
          resolve(msg.content.toString("utf-8"));
        },
        { noAck: true },
      ).then(() => {
        ch.sendToQueue(params.queue, Buffer.from(params.payload), {
          correlationId,
          replyTo: "amq.rabbitmq.reply-to",
          contentType: "application/json",
        });
      }).catch((err) => {
        clearTimeout(t);
        reject(err);
      });
    });
    return { correlationId, payload: result };
  } finally {
    try {
      await ch.close();
    } catch {
    }
  }
}

/** @description 返回当前 RabbitMQ 传输层统计快照（浅拷贝）。 */
export function getStats(): RabbitmqStats {
  return { ...stats };
}

/** @description 入站消息被 channel 接受时的统计钩子（预留扩展）。 */
export function trackInboundAccepted(): void {
}

/** @description 记录入站丢弃原因并递增错误计数。 @param reason - 丢弃原因标识 */
export function trackInboundDropped(reason: string): void {
  stats.errors++;
  stats.lastError = `inbound_dropped:${reason}`;
}

/** @description 路由命中来源追踪钩子（binding / standard 等）。 @param source - 路由来源标识 */
export function trackRoute(source: string): void {
}

/**
 * @description 带指数退避的重连循环：在 `reconnectAttempts` 耗尽前反复调用 `connectOnce`。
 * @returns 连接成功时 resolve；全部失败时抛出最后一次错误
 * @throws 配置未设置或所有重连尝试均失败
 */
async function connectWithRetry(): Promise<void> {
  const cfg = config;
  if (!cfg) {
    throw new Error("RabbitMQ config not set");
  }
  const maxAttempts = cfg.connection.reconnectAttempts + 1;
  let attempt = 0;
  let lastErr: unknown = null;
  while (!stopping && attempt < maxAttempts) {
    attempt++;
    try {
      await connectOnce(cfg);
      return;
    } catch (err) {
      lastErr = err;
      stats.errors++;
      stats.lastError = err instanceof Error ? err.message : String(err);
      if (attempt >= maxAttempts) {
        break;
      }
      await sleep(cfg.connection.reconnectDelayMs);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * @description 单次 AMQP 连接：声明 Exchange/Queue、绑定订阅模式并启动 consume 回调。
 * @param cfg - 已解析的 RabbitMQ 通道配置
 * @returns Promise，连接建立并开始消费后 resolve
 * @throws amqplib 连接或声明失败
 */
async function connectOnce(cfg: RabbitmqConfig): Promise<void> {
  const socketOptions: Options.Connect = {
    heartbeat: cfg.connection.heartbeatSeconds,
  };
  const conn = await amqp.connect(cfg.url, {
    ...socketOptions,
    timeout: cfg.connection.timeoutMs,
  });
  connection = conn;
  stats.connected = true;
  stats.lastConnectAt = Date.now();
  stats.lastError = null;

  const consumeCh = await conn.createChannel();
  const publishCh = await conn.createChannel();
  consumeChannel = consumeCh;
  publishChannel = publishCh;

  await consumeCh.assertExchange(cfg.exchange, cfg.exchangeType, { durable: cfg.exchangeDurable });

  const queueName = cfg.queue.name?.trim() ? cfg.queue.name.trim() : "";
  const queueArgs: Record<string, unknown> = {};
  if (cfg.queue.quorum) {
    queueArgs["x-queue-type"] = "quorum";
  }
  const queue = await consumeCh.assertQueue(queueName, {
    exclusive: queueName ? cfg.queue.exclusive : true,
    durable: queueName ? cfg.queue.durable : false,
    autoDelete: queueName ? cfg.queue.autoDelete : true,
    arguments: Object.keys(queueArgs).length > 0 ? queueArgs : undefined,
  });
  retryQueueName = cfg.retry.enabled && queue.queue ? `${queue.queue}${cfg.retry.queueSuffix}` : null;
  retryRoutingPrefix = retryQueueName ? `${queue.queue}.retry` : null;
  if (retryQueueName && retryRoutingPrefix) {
    await consumeCh.assertQueue(retryQueueName, {
      durable: cfg.queue.durable,
      exclusive: false,
      autoDelete: false,
      arguments: {
        ...(cfg.queue.quorum ? { "x-queue-type": "quorum" } : {}),
        "x-message-ttl": cfg.retry.delayMs,
        "x-dead-letter-exchange": cfg.exchange,
      },
    });
    await consumeCh.bindQueue(retryQueueName, cfg.exchange, `${retryRoutingPrefix}.#`);
  }

  const patterns = collectSubscribePatterns(cfg);
  for (const pattern of patterns) {
    await consumeCh.bindQueue(queue.queue, cfg.exchange, pattern);
  }
  if (retryRoutingPrefix) {
    await consumeCh.bindQueue(queue.queue, cfg.exchange, `${retryRoutingPrefix}.#`);
  }

  inboundLimiter = createInboundLimiter(cfg.consume.concurrency);
  const effectivePrefetch = Math.max(cfg.consume.prefetch, cfg.consume.concurrency);
  if (effectivePrefetch > 0) {
    await consumeCh.prefetch(effectivePrefetch);
  }

  const { consumerTag: tag } = await consumeCh.consume(
    queue.queue,
    (msg: ConsumeMessage | null) => {
      if (!msg || !inboundHandler || !consumeChannel || !config || !inboundLimiter) {
        return;
      }
      const handler = inboundHandler;
      const activeConfig = config;
      const channel = consumeChannel;
      const limiter = inboundLimiter;
      stats.messagesReceived++;
      const routingKey = resolveInboundRoutingKey(msg);
      const event: InboundEvent = {
        routingKey,
        content: msg.content,
        properties: msg.properties,
        fields: { ...msg.fields, routingKey },
      };
      void limiter(async () => {
        stats.inFlight++;
        try {
          const disposition = await handler(event);
          stats.lastConsumeAt = Date.now();
          if (disposition.ok) {
            channel.ack(msg);
            stats.messagesAcked++;
            return;
          }
          const handledByRetry = await maybeRetryMessage(msg, routingKey);
          if (handledByRetry) {
            return;
          }
          const requeue = disposition.requeue ?? activeConfig.consume.requeueOnError;
          channel.nack(msg, false, requeue);
          stats.messagesNacked++;
          if (requeue) {
            stats.messagesRequeued++;
          }
        } catch (err) {
          stats.errors++;
          stats.lastError = err instanceof Error ? err.message : String(err);
          const handledByRetry = await maybeRetryMessage(msg, routingKey);
          if (handledByRetry) {
            return;
          }
          const requeue = activeConfig.consume.requeueOnError;
          channel.nack(msg, false, requeue);
          stats.messagesNacked++;
          if (requeue) {
            stats.messagesRequeued++;
          }
        } finally {
          stats.inFlight = Math.max(0, stats.inFlight - 1);
        }
      });
    },
    { noAck: false },
  );
  consumerTag = tag;

  conn.on("error", (err: unknown) => {
    stats.errors++;
    stats.lastError = err instanceof Error ? err.message : String(err);
  });

  conn.on("close", () => {
    stats.connected = false;
    stats.lastDisconnectAt = Date.now();
    if (!stopping) {
      void reconnectAfterClose();
    }
  });
}

/**
 * @description 连接意外关闭后的异步重连入口（非 stopping 状态下触发）。
 * @returns Promise，重连失败时静默吞掉错误以避免未捕获 rejection
 */
async function reconnectAfterClose(): Promise<void> {
  const cfg = config;
  if (!cfg || stopping) {
    return;
  }
  await teardownTransport();
  await sleep(cfg.connection.reconnectDelayMs);
  if (stopping) {
    return;
  }
  await connectWithRetry().catch(() => {});
}

/**
 * @description 关闭当前 channel/connection 引用，便于重连前清理（不修改 stopping 标志）。
 */
async function teardownTransport(): Promise<void> {
  inboundLimiter = null;
  retryRoutingPrefix = null;
  retryQueueName = null;
  try {
    if (consumeChannel && consumerTag) {
      await consumeChannel.cancel(consumerTag);
    }
  } catch {
  } finally {
    consumerTag = null;
  }
  try {
    if (consumeChannel) {
      await consumeChannel.close();
    }
  } catch {
  } finally {
    consumeChannel = null;
  }
  try {
    if (publishChannel) {
      await publishChannel.close();
    }
  } catch {
  } finally {
    publishChannel = null;
  }
  try {
    if (connection) {
      await connection.close();
    }
  } catch {
  } finally {
    connection = null;
  }
  stats.connected = false;
  stats.lastDisconnectAt = Date.now();
}

/**
 * @description 限制入站 handler 并发，避免 prefetch 窗口内无界并行。
 */
function createInboundLimiter(concurrency: number) {
  let running = 0;
  const waiters: Array<() => void> = [];
  const next = (): void => {
    if (running >= concurrency) {
      return;
    }
    const resume = waiters.shift();
    if (resume) {
      resume();
    }
  };
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = (): Promise<T> => {
      running++;
      return fn().finally(() => {
        running--;
        next();
      });
    };
    if (running < concurrency) {
      return run();
    }
    return new Promise<T>((resolve, reject) => {
      waiters.push(() => {
        run().then(resolve, reject);
      });
    });
  };
}

/**
 * @description 从 AMQP headers 解析原始 routing key（retry DLX 回流时保留业务 key）。
 */
function resolveInboundRoutingKey(msg: ConsumeMessage): string {
  const headers = msg.properties.headers;
  const raw = headers?.["x-original-routing-key"];
  if (typeof raw === "string" && raw.length > 0) {
    return raw;
  }
  if (raw && typeof raw === "object" && "value" in raw) {
    const value = (raw as { value?: unknown }).value;
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return msg.fields.routingKey;
}

/**
 * @description 汇总需绑定到 Queue 的 routing key 模式（subscribeTopics + topicBindings，默认 `{prefix}.#`）。
 * @param cfg - 通道配置
 * @returns 去重后的 binding pattern 数组
 */
function collectSubscribePatterns(cfg: RabbitmqConfig): string[] {
  const patterns = new Set<string>();
  for (const p of cfg.subscribeTopics) {
    patterns.add(p);
  }
  for (const b of cfg.topicBindings) {
    patterns.add(b.topicPattern);
  }
  if (patterns.size === 0) {
    patterns.add(`${cfg.topicPrefix}.#`);
  }
  return [...patterns];
}

/**
 * @description 异步 sleep 工具（重连退避与 retry 延迟）。
 * @param ms - 等待毫秒数；≤0 时立即 resolve
 * @returns 延迟结束的 Promise
 */
function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @description 将失败消息投递到 retry 队列（带 `x-attempt` 头），未超 maxAttempts 时 ACK 原消息。
 * @param msg - 原始 AMQP 消费消息
 * @returns 是否已由 retry 队列接管（true 时调用方无需再 nack）
 */
async function maybeRetryMessage(msg: ConsumeMessage, routingKey: string): Promise<boolean> {
  const cfg = config;
  if (!cfg || !consumeChannel || !retryQueueName || !retryRoutingPrefix || !cfg.retry.enabled) {
    return false;
  }
  const raw = (msg.properties.headers as Record<string, unknown> | undefined)?.["x-attempt"];
  const attempt =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseInt(raw, 10)
        : 0;
  if (attempt >= cfg.retry.maxAttempts) {
    return false;
  }
  const nextAttempt = attempt + 1;
  const originalRoutingKey = resolveInboundRoutingKey(msg);
  const headers = {
    ...(typeof msg.properties.headers === "object" && msg.properties.headers ? msg.properties.headers : {}),
    "x-attempt": nextAttempt,
    "x-original-routing-key": originalRoutingKey || routingKey,
  };
  consumeChannel.publish(cfg.exchange, `${retryRoutingPrefix}.${routingKey}`, msg.content, {
    correlationId: msg.properties.correlationId,
    contentType: msg.properties.contentType ?? "application/json",
    headers,
    persistent: true,
  });
  consumeChannel.ack(msg);
  stats.messagesAcked++;
  return true;
}
