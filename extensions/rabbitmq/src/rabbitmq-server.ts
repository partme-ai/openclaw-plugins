import amqp from "amqplib";
import { randomUUID } from "node:crypto";
import type { ConsumeMessage, ChannelModel, Channel, Options } from "amqplib";
import type { RabbitmqConfig } from "./rabbitmq-config.js";

export type InboundEvent = {
  routingKey: string;
  content: Buffer;
  properties: ConsumeMessage["properties"];
  fields: ConsumeMessage["fields"];
};

export type InboundDisposition =
  | { ok: true }
  | { ok: false; requeue?: boolean; reason?: string };

export type InboundHandler = (event: InboundEvent) => Promise<InboundDisposition>;

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

export async function startRabbitmqServer(cfg: RabbitmqConfig, handler: InboundHandler): Promise<void> {
  config = cfg;
  inboundHandler = handler;
  stopping = false;
  await connectWithRetry();
}

export async function stopRabbitmqServer(): Promise<void> {
  stopping = true;
  consumerTag = null;
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

export function getStats(): RabbitmqStats {
  return { ...stats };
}

export function trackInboundAccepted(): void {
}

export function trackInboundDropped(reason: string): void {
  stats.errors++;
  stats.lastError = `inbound_dropped:${reason}`;
}

export function trackRoute(source: string): void {
}

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
  if (retryQueueName) {
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
  }

  const patterns = collectSubscribePatterns(cfg);
  for (const pattern of patterns) {
    await consumeCh.bindQueue(queue.queue, cfg.exchange, pattern);
  }

  const effectivePrefetch = Math.max(cfg.consume.prefetch, cfg.consume.concurrency);
  if (effectivePrefetch > 0) {
    await consumeCh.prefetch(effectivePrefetch);
  }

  const { consumerTag: tag } = await consumeCh.consume(
    queue.queue,
    (msg: ConsumeMessage | null) => {
      if (!msg || !inboundHandler || !consumeChannel || !config) {
        return;
      }
      stats.messagesReceived++;
      stats.inFlight++;
      const event: InboundEvent = {
        routingKey: msg.fields.routingKey,
        content: msg.content,
        properties: msg.properties,
        fields: msg.fields,
      };
      void (async () => {
        try {
          const disposition = await inboundHandler(event);
          stats.lastConsumeAt = Date.now();
          if (disposition.ok) {
            consumeChannel?.ack(msg);
            stats.messagesAcked++;
            return;
          }
          const handledByRetry = await maybeRetryMessage(msg);
          if (handledByRetry) {
            return;
          }
          const requeue = disposition.requeue ?? config.consume.requeueOnError;
          consumeChannel?.nack(msg, false, requeue);
          stats.messagesNacked++;
          if (requeue) {
            stats.messagesRequeued++;
          }
        } catch (err) {
          stats.errors++;
          stats.lastError = err instanceof Error ? err.message : String(err);
          const handledByRetry = await maybeRetryMessage(msg);
          if (handledByRetry) {
            return;
          }
          const requeue = config.consume.requeueOnError;
          consumeChannel?.nack(msg, false, requeue);
          stats.messagesNacked++;
          if (requeue) {
            stats.messagesRequeued++;
          }
        } finally {
          stats.inFlight = Math.max(0, stats.inFlight - 1);
        }
      })();
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

async function reconnectAfterClose(): Promise<void> {
  const cfg = config;
  if (!cfg || stopping) {
    return;
  }
  await sleep(cfg.connection.reconnectDelayMs);
  if (stopping) {
    return;
  }
  await connectWithRetry().catch(() => {});
}

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

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function maybeRetryMessage(msg: ConsumeMessage): Promise<boolean> {
  const cfg = config;
  if (!cfg || !consumeChannel || !retryQueueName || !cfg.retry.enabled) {
    return false;
  }
  const raw = (msg.properties.headers as any)?.["x-attempt"];
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
  const headers = {
    ...(typeof msg.properties.headers === "object" && msg.properties.headers ? msg.properties.headers : {}),
    "x-attempt": nextAttempt,
  };
  consumeChannel.sendToQueue(retryQueueName, msg.content, {
    correlationId: msg.properties.correlationId,
    contentType: msg.properties.contentType ?? "application/json",
    headers,
    persistent: true,
  });
  consumeChannel.ack(msg);
  stats.messagesAcked++;
  return true;
}
