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
import { once } from "node:events";
import type { ConsumeMessage, ChannelModel, Channel, ConfirmChannel, Options } from "amqplib";
import type { RabbitmqConfig } from "../config.js";
import { redactRabbitmqError } from "../shared/redact.js";

/** @description 入站 AMQP 消息的投递处置句柄（deferred ack）。 */
export type InboundDeliveryHandle = {
  /** 是否已通过 ack/nack 处置 */
  readonly settled: boolean;
  /** 确认消息已成功处理 */
  ack: () => void;
  /** 拒绝消息，可选 requeue 与原因 */
  nack: (options?: { requeue?: boolean; reason?: string }) => void;
};

/** @description 入站 AMQP 消息事件（routingKey + 原始 body + 属性 + delivery 句柄）。 */
export type InboundEvent = {
  routingKey: string;
  content: Buffer;
  properties: ConsumeMessage["properties"];
  fields: ConsumeMessage["fields"];
  delivery: InboundDeliveryHandle;
};

/** @description 消费端对单条消息的处置结果（ACK / NACK / 重入队 / 手动 ack）。 */
export type InboundDisposition =
  | { ok: true; ackMode?: "auto" | "manual" }
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
  messagesRetried: number;
  messagesDeadLettered: number;
  publishConfirmed: number;
  reconnecting: boolean;
  errors: number;
  inFlight: number;
};

let connection: ChannelModel | null = null;
let consumeChannel: Channel | null = null;
let publishChannel: ConfirmChannel | null = null;
let consumerTag: string | null = null;
let inboundHandler: InboundHandler | null = null;
let config: RabbitmqConfig | null = null;
let stopping = false;
let retryExchangeName: string | null = null;
let deadLetterExchangeName: string | null = null;
let reconnectPromise: Promise<void> | null = null;
let inboundLimiter: ReturnType<typeof createInboundLimiter> | null = null;
type TransportLogger = { debug?(message: string): void; info?(message: string): void; warn?(message: string): void; error?(message: string): void };
const NOOP_LOGGER: TransportLogger = {};
let transportLogger: TransportLogger = NOOP_LOGGER;
const pendingDeliveries = new Set<InboundDeliveryHandle>();
/** 已被 Broker 投递并进入并发限制器的任务；优雅停机必须等待这些任务完成处置。 */
const inboundTasks = new Set<Promise<void>>();
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
  messagesRetried: 0,
  messagesDeadLettered: 0,
  publishConfirmed: 0,
  reconnecting: false,
  errors: 0,
  inFlight: 0,
};

/**
 * @description 启动 RabbitMQ 服务：建立连接、声明 Exchange/Queue、绑定订阅并开始消费。
 * @param cfg - 已解析的 RabbitMQ 通道配置
 * @param handler - 入站消息处理器（通常为 processInbound）
 */
export async function startRabbitmqServer(cfg: RabbitmqConfig, handler: InboundHandler, logger: TransportLogger = NOOP_LOGGER): Promise<void> {
  config = cfg;
  inboundHandler = handler;
  stopping = false;
  transportLogger = logger;
  await connectWithRetry();
}

/**
 * @description 优雅关闭 RabbitMQ：取消消费、关闭 channel 与 connection。
 */
export async function stopRabbitmqServer(): Promise<void> {
  stopping = true;
  inboundLimiter = null;
  try {
    if (consumeChannel && consumerTag) {
      await consumeChannel.cancel(consumerTag);
    }
  } catch {
  } finally {
    consumerTag = null;
  }
  // cancel 后保持 publish channel 与 retry/DLQ exchange 可用，让已接纳 Agent Turn 完成 ACK 或
  // 可靠转移。若先 NACK 再等待后台 Turn，会导致同一业务副作用在旧 Turn 和 Broker 重投中各执行一次。
  if (inboundTasks.size > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const drained = await Promise.race([
      Promise.allSettled([...inboundTasks]).then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), config?.consume.shutdownTimeoutMs ?? 30_000);
        timer.unref();
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (!drained) {
      transportLogger.warn?.(
        `[openclaw-rabbitmq] shutdown drain timed out after ${config?.consume.shutdownTimeoutMs ?? 30_000}ms; ` +
        `${inboundTasks.size} task(s) will be requeued with outcome possibly unknown`,
      );
      // 已超时任务仍可能在其内部 Promise 中悬挂；从生命周期跟踪集移除，避免后续重启/停止
      // 再次等待同一批旧任务。delivery 会在下方统一 NACK，迟到任务因 settled=true 不会重复处置。
      inboundTasks.clear();
    }
  }
  nackAllPendingDeliveries(true, "server_stop");
  retryExchangeName = null;
  deadLetterExchangeName = null;
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
  stats.reconnecting = false;
  transportLogger = NOOP_LOGGER;
}

/** 入站编排复用 Channel logger，避免协议代码直接写 console。 */
export function logRabbitmq(level: "debug" | "warn" | "error", message: string): void {
  transportLogger[level]?.(message);
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
    persistent: opts?.persistent !== false,
    correlationId: opts?.correlationId,
    headers: opts?.headers,
    contentType: "application/json",
  };
  await publishConfirmed(publishChannel, config.exchange, routingKey, Buffer.from(message), options);
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
  if (!params.queue.trim()) {
    throw new Error("mq.request queue is required");
  }
  if (!Number.isInteger(params.timeoutMs) || params.timeoutMs <= 0) {
    throw new Error("mq.request timeoutMs must be a positive integer");
  }
  /*
   * RPC 也使用 ConfirmChannel。普通 Channel 的 sendToQueue 返回 true 只表示写入本地 socket
   * 缓冲区，并不代表 Broker 已接收；确认发布 + mandatory 可以同时识别 Broker NACK、超时、
   * 背压以及目标队列不存在，避免工具返回“请求已发送”的假成功。
   */
  const ch = await connection.createConfirmChannel();
  const correlationId = params.correlationId ?? randomUUID();
  try {
    const result = await new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("mq.request timeout")), params.timeoutMs);
      t.unref?.();
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
      ).then(async () => {
        await publishConfirmed(ch, "", params.queue.trim(), Buffer.from(params.payload), {
          correlationId,
          replyTo: "amq.rabbitmq.reply-to",
          contentType: "application/json",
          persistent: true,
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
  stats.lastError = `inbound_dropped:${redactRabbitmqError(reason, config)}`;
}

/** @description 路由命中来源追踪钩子（binding / standard 等）。 @param source - 路由来源标识 */
export function trackRoute(source: string): void {
}

/**
 * @description 带指数退避和随机抖动的重连循环：在 `reconnectAttempts` 耗尽前反复调用 `connectOnce`。
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
      stats.lastError = redactRabbitmqError(err, cfg);
      await teardownTransport();
      if (attempt >= maxAttempts) {
        break;
      }
      await sleep(computeReconnectDelay(cfg, attempt - 1));
    }
  }
  throw new Error(redactRabbitmqError(lastErr, cfg));
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
  const publishCh = await conn.createConfirmChannel();
  consumeChannel = consumeCh;
  publishChannel = publishCh;

  await consumeCh.assertExchange(cfg.exchange, cfg.exchangeType, { durable: cfg.exchangeDurable });
  await publishCh.assertExchange(cfg.exchange, cfg.exchangeType, { durable: cfg.exchangeDurable });

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
  retryExchangeName = cfg.retry.enabled ? `${cfg.exchange}.retry` : null;
  deadLetterExchangeName = `${cfg.exchange}.dlx`;
  await consumeCh.assertExchange(deadLetterExchangeName, "topic", { durable: true });
  const deadLetterQueueName = `${queue.queue}${cfg.retry.deadLetterSuffix}`;
  await consumeCh.assertQueue(deadLetterQueueName, {
    durable: true,
    exclusive: false,
    autoDelete: false,
    arguments: cfg.queue.quorum ? { "x-queue-type": "quorum" } : undefined,
  });
  await consumeCh.bindQueue(deadLetterQueueName, deadLetterExchangeName, "#");
  if (retryExchangeName) {
    await consumeCh.assertExchange(retryExchangeName, "topic", { durable: true });
    const retryQueueName = `${queue.queue}${cfg.retry.queueSuffix}`;
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
    for (const pattern of collectSubscribePatterns(cfg)) {
      await consumeCh.bindQueue(retryQueueName, retryExchangeName, pattern);
    }
  }

  const patterns = collectSubscribePatterns(cfg);
  for (const pattern of patterns) {
    await consumeCh.bindQueue(queue.queue, cfg.exchange, pattern);
  }

  inboundLimiter = createInboundLimiter(cfg.consume.concurrency);
  const effectivePrefetch = Math.max(cfg.consume.prefetch, cfg.consume.concurrency);
  if (effectivePrefetch > 0) {
    await consumeCh.prefetch(effectivePrefetch);
  }

  const { consumerTag: tag } = await consumeCh.consume(
    queue.queue,
    (msg: ConsumeMessage | null) => {
      if (msg && stopping) {
        consumeChannel?.nack(msg, false, true);
        return;
      }
      if (!msg || !inboundHandler || !consumeChannel || !config || !inboundLimiter) {
        return;
      }
      const handler = inboundHandler;
      const activeConfig = config;
      const channel = consumeChannel;
      const limiter = inboundLimiter;
      stats.messagesReceived++;
      const routingKey = resolveInboundRoutingKey(msg);
      const delivery = createInboundDeliveryHandle(msg, channel, activeConfig);
      const event: InboundEvent = {
        routingKey,
        content: msg.content,
        properties: msg.properties,
        fields: { ...msg.fields, routingKey },
        delivery,
      };
      const task = limiter(async () => {
        stats.inFlight++;
        try {
          const disposition = await handler(event);
          stats.lastConsumeAt = Date.now();
          if (disposition.ok) {
            if (disposition.ackMode === "manual") {
              if (!delivery.settled) {
                delivery.nack({
                  requeue: activeConfig.consume.requeueOnError,
                  reason: "manual_ack_unsettled",
                });
              }
              return;
            }
            if (!delivery.settled) {
              delivery.ack();
            }
            return;
          }
          if (delivery.settled) {
            return;
          }
          try {
            if (await maybeRetryMessage(msg, routingKey, delivery)) return;
          } catch (retryError) {
            stats.errors++;
            stats.lastError = redactRabbitmqError(retryError, activeConfig);
            delivery.nack({ requeue: true, reason: "retry_publish_failed" });
            return;
          }
          const requeue = disposition.requeue ?? activeConfig.consume.requeueOnError;
          delivery.nack({ requeue, reason: disposition.reason });
        } catch (err) {
          stats.errors++;
          stats.lastError = redactRabbitmqError(err, activeConfig);
          if (delivery.settled) {
            return;
          }
          try {
            if (await maybeRetryMessage(msg, routingKey, delivery)) return;
          } catch (retryError) {
            stats.errors++;
            stats.lastError = redactRabbitmqError(retryError, activeConfig);
            delivery.nack({ requeue: true, reason: "retry_publish_failed" });
            return;
          }
          const requeue = activeConfig.consume.requeueOnError;
          delivery.nack({ requeue, reason: redactRabbitmqError(err, activeConfig) });
        } finally {
          pendingDeliveries.delete(delivery);
          stats.inFlight = Math.max(0, stats.inFlight - 1);
        }
      }).catch((error: unknown) => {
        stats.errors++;
        stats.lastError = redactRabbitmqError(error, activeConfig);
      });
      inboundTasks.add(task);
      void task.finally(() => inboundTasks.delete(task));
    },
    { noAck: false },
  );
  consumerTag = tag;

  conn.on("error", (err: unknown) => {
    stats.errors++;
    stats.lastError = redactRabbitmqError(err, cfg);
  });

  conn.on("close", () => {
    stats.connected = false;
    stats.lastDisconnectAt = Date.now();
    if (!stopping) {
      reconnectPromise ??= reconnectAfterClose().finally(() => {
        reconnectPromise = null;
      });
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
  stats.reconnecting = true;
  while (!stopping) {
    await teardownTransport();
    await sleep(computeReconnectDelay(cfg, 0));
    if (stopping) return;
    try {
      await connectWithRetry();
      stats.reconnecting = false;
      return;
    } catch (error) {
      stats.errors++;
      stats.lastError = redactRabbitmqError(error, cfg);
    }
  }
  stats.reconnecting = false;
}

/**
 * @description 关闭当前 channel/connection 引用，便于重连前清理（不修改 stopping 标志）。
 */
async function teardownTransport(): Promise<void> {
  nackAllPendingDeliveries(true, "transport_teardown");
  inboundLimiter = null;
  retryExchangeName = null;
  deadLetterExchangeName = null;
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
 * 计算单次重连等待时间。
 *
 * `failureIndex` 从 0 开始：第一次失败等待基础间隔，随后按 2 的指数增长并受最大值限制；
 * 最后加入双向随机抖动，避免一批 Gateway 在 RabbitMQ 恢复瞬间同时发起连接。
 * 导出该纯函数是为了让边界值可被单元测试稳定验证。
 */
export function computeReconnectDelay(
  cfg: RabbitmqConfig,
  failureIndex: number,
  random: () => number = Math.random,
): number {
  const base = Math.min(
    cfg.connection.reconnectDelayMs * 2 ** Math.max(0, failureIndex),
    cfg.connection.reconnectMaxDelayMs,
  );
  const jitter = base * cfg.connection.reconnectJitterRatio * (random() * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}

/**
 * @description 将失败消息投递到 retry 队列（带 `x-attempt` 头），未超 maxAttempts 时 ACK 原消息。
 * @param msg - 原始 AMQP 消费消息
 * @returns 是否已由 retry 队列接管（true 时调用方无需再 nack）
 */
async function maybeRetryMessage(
  msg: ConsumeMessage,
  routingKey: string,
  delivery: InboundDeliveryHandle,
): Promise<boolean> {
  const cfg = config;
  if (!cfg || !cfg.retry.enabled || !publishChannel || !deadLetterExchangeName) {
    return false;
  }
  const raw = (msg.properties.headers as Record<string, unknown> | undefined)?.["x-attempt"];
  /* 外部 header 不可信：只接受非负整数，避免 NaN/负数绕过最大重试次数。 */
  const parsedAttempt = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : 0;
  const attempt = Number.isSafeInteger(parsedAttempt) && parsedAttempt >= 0 ? parsedAttempt : 0;
  const originalRoutingKey = resolveInboundRoutingKey(msg);
  if (attempt >= cfg.retry.maxAttempts || !retryExchangeName) {
    await publishConfirmed(
      publishChannel,
      deadLetterExchangeName,
      originalRoutingKey || routingKey,
      msg.content,
      {
        correlationId: msg.properties.correlationId,
        messageId: msg.properties.messageId,
        contentType: msg.properties.contentType ?? "application/json",
        headers: {
          ...(typeof msg.properties.headers === "object" && msg.properties.headers ? msg.properties.headers : {}),
          "x-final-attempt": attempt,
          "x-original-routing-key": originalRoutingKey || routingKey,
        },
        persistent: true,
      },
    );
    delivery.ack();
    stats.messagesDeadLettered++;
    return true;
  }
  const nextAttempt = attempt + 1;
  const headers = {
    ...(typeof msg.properties.headers === "object" && msg.properties.headers ? msg.properties.headers : {}),
    "x-attempt": nextAttempt,
    "x-original-routing-key": originalRoutingKey || routingKey,
  };
  await publishConfirmed(publishChannel, retryExchangeName, originalRoutingKey || routingKey, msg.content, {
    correlationId: msg.properties.correlationId,
    messageId: msg.properties.messageId,
    contentType: msg.properties.contentType ?? "application/json",
    headers,
    persistent: true,
  });
  delivery.ack();
  stats.messagesRetried++;
  return true;
}

async function publishConfirmed(
  channel: ConfirmChannel,
  exchange: string,
  routingKey: string,
  content: Buffer,
  options: Options.Publish,
): Promise<void> {
  const timeoutMs = config?.connection.publishConfirmTimeoutMs ?? 10000;
  const publishId = randomUUID();
  let timer: NodeJS.Timeout | undefined;
  let writable = true;
  const confirmation = new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      if (timer) clearTimeout(timer);
      channel.off("return", onReturned);
    };
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onReturned = (returned: ConsumeMessage): void => {
      if (returned.properties.headers?.["x-openclaw-publish-id"] !== publishId) return;
      finish(new Error(`RabbitMQ message was unroutable for routingKey=${routingKey}`));
    };
    channel.on("return", onReturned);
    timer = setTimeout(
      () => finish(new Error(`RabbitMQ publish confirm timeout for routingKey=${routingKey}`)),
      timeoutMs,
    );
    timer.unref?.();
    writable = channel.publish(exchange, routingKey, content, {
      ...options,
      mandatory: true,
      headers: {
        ...(options.headers ?? {}),
        "x-openclaw-publish-id": publishId,
      },
    }, (error) => {
      if (error) {
        finish(error);
        return;
      }
      /* RabbitMQ 会在同一消息的 publisher confirm 之前发送 basic.return；延后一拍再成功收口。 */
      setImmediate(() => finish());
    });
  });
  const drained = writable ? Promise.resolve() : once(channel, "drain").then(() => undefined);
  await Promise.all([confirmation, drained]);
  stats.publishConfirmed++;
}

/**
 * @description 为单条消费消息创建 deferred ack 句柄并纳入 pending 跟踪。
 */
function createInboundDeliveryHandle(
  msg: ConsumeMessage,
  channel: Channel,
  activeConfig: RabbitmqConfig,
): InboundDeliveryHandle {
  let settled = false;
  const handle: InboundDeliveryHandle = {
    get settled() {
      return settled;
    },
    ack: () => {
      if (settled) {
        return;
      }
      settled = true;
      channel.ack(msg);
      stats.messagesAcked++;
    },
    nack: (options) => {
      if (settled) {
        return;
      }
      settled = true;
      const requeue = options?.requeue ?? activeConfig.consume.requeueOnError;
      channel.nack(msg, false, requeue);
      stats.messagesNacked++;
      if (requeue) {
        stats.messagesRequeued++;
      }
      if (options?.reason) {
        stats.lastError = `inbound_nack:${redactRabbitmqError(options.reason, activeConfig)}`;
      }
    },
  };
  pendingDeliveries.add(handle);
  return handle;
}

/**
 * @description 停止/重连前 nack 所有尚未 settle 的 pending 投递。
 */
function nackAllPendingDeliveries(requeue: boolean, reason: string): void {
  for (const delivery of pendingDeliveries) {
    if (!delivery.settled) {
      delivery.nack({ requeue, reason });
    }
  }
  pendingDeliveries.clear();
}
