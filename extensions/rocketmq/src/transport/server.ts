/**
 * @fileoverview RocketMQ 传输层：Producer / PushConsumer 封装与连接统计。
 *
 * @description
 * 基于 `rocketmq-client-nodejs` 管理长连接 Producer 与 PushConsumer，提供自动重连、
 * 入站 ACK/重消费策略、出站 one-shot Producer 回退及诊断统计 API。
 *
 * @module transport/server
 */

/**
 * RocketMQ MQ 传输层 — 消息收发与统计入口。
 */

import { ConsumeResult, Producer, PushConsumer, type MessageView } from "rocketmq-client-nodejs";
import type { RockermqConfig } from "../config.js";

/** @description PushConsumer 回调的入站消息事件。 */
export type InboundEvent = {
  topic: string;
  tag?: string;
  body: Buffer;
  keys?: string[];
  messageId?: string;
  deliveryAttempt?: number;
};

/** @description 消费端处置结果（SUCCESS / 触发 reconsume）。 */
export type InboundDisposition = { ok: true } | { ok: false; reconsume?: boolean; reason?: string };

/** @description 入站消息处理器类型。 */
export type InboundHandler = (event: InboundEvent) => Promise<InboundDisposition>;

/** @description RocketMQ 客户端连接与消息统计。 */
export type RockermqStats = {
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

/** RocketMQ 启动重连默认参数（与 RabbitMQ connection 默认值对齐）。 */
const DEFAULT_RECONNECT_ATTEMPTS = 5;
const DEFAULT_RECONNECT_DELAY_MS = 5000;

let producer: Producer | null = null;
let consumer: PushConsumer | null = null;
let config: RockermqConfig | null = null;
let inboundHandler: InboundHandler | null = null;
let stopping = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let startupPromise: Promise<void> | null = null;

const stats: RockermqStats = {
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
 * @description 启动 RocketMQ Producer 与 PushConsumer（含重试连接）。
 * @param cfg - RocketMQ 运行时配置。
 * @param handler - 入站消息处置回调。
 * @returns 首次连接成功后的 Promise。
 * @throws 重试耗尽后抛出最后一次连接错误。
 */
export async function startRockermqServer(
  cfg: RockermqConfig,
  handler: InboundHandler,
): Promise<void> {
  config = cfg;
  inboundHandler = handler;
  stopping = false;
  startupPromise = connectWithRetry();
  await startupPromise;
}

/**
 * @description 关闭 RocketMQ 客户端并清理重连定时器。
 * @returns shutdown 完成后的 Promise。
 * @throws 不抛出；shutdown 错误被吞掉。
 */
export async function stopRockermqServer(): Promise<void> {
  stopping = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  await teardownTransport();
}

/**
 * @description 发送 RocketMQ 消息；无长连 Producer 时使用 one-shot Producer。
 * @param params - topic、tag、payload 及可选 endpoints/凭据覆盖。
 * @returns SDK send receipt（含 messageId 等）。
 * @throws endpoints 不可用或 send 失败时抛出。
 */
export async function publishMessage(params: {
  topic: string;
  tag?: string;
  payload: string;
  keys?: string[];
  endpoints?: string;
  namespace?: string;
  requestTimeout?: number;
  sessionCredentials?: RockermqConfig["sessionCredentials"];
}): Promise<unknown> {
  if (producer) {
    const receipt = await producer.send({
      topic: params.topic,
      tag: params.tag,
      keys: params.keys,
      body: Buffer.from(params.payload),
    });
    stats.messagesSent++;
    return receipt;
  }

  // Fallback for subagent/child-process contexts: create one-shot producer
  const endpoints = params.endpoints ?? config?.endpoints;
  if (!endpoints) {
    throw new Error("RocketMQ endpoints not available");
  }
  const oneShot = new Producer({
    endpoints,
    namespace: params.namespace ?? config?.namespace ?? "",
    requestTimeout: params.requestTimeout ?? config?.producer?.requestTimeout ?? 5000,
    sessionCredentials: params.sessionCredentials ?? config?.sessionCredentials,
  });
  try {
    await oneShot.startup();
    const receipt = await oneShot.send({
      topic: params.topic,
      tag: params.tag,
      keys: params.keys,
      body: Buffer.from(params.payload),
    });
    stats.messagesSent++;
    return receipt;
  } finally {
    await oneShot.shutdown();
  }
}

/**
 * @description 读取当前连接与消息统计快照（浅拷贝）。
 * @returns `RockermqStats` 副本。
 * @throws 不抛出。
 */
export function getStats(): RockermqStats {
  return { ...stats };
}

/**
 * @description 入站 accepted 追踪占位（统计经 messagesReceived/messagesAcked 体现）。
 * @returns void
 * @throws 不抛出。
 */
export function trackInboundAccepted(): void {
  // accepted counts are tracked via messagesReceived + messagesAcked
}

/**
 * @description 记录入站丢弃原因并递增 errors。
 * @param reason - 丢弃原因码。
 * @returns void
 * @throws 不抛出。
 */
export function trackInboundDropped(reason: string): void {
  stats.errors++;
  stats.lastError = `inbound_dropped:${reason}`;
}

/**
 * @description 路由来源追踪占位（binding / standard 等，供诊断扩展）。
 * @param _source - 路由来源标签。
 * @returns void
 * @throws 不抛出。
 */
export function trackRoute(_source: string): void {
  // route tracking for diagnostics
}

// ─────────────── 内部实现 ───────────────

/**
 * @description 带固定间隔的重试连接（最多 5 次）。
 * @returns 连接成功后的 Promise。
 * @throws 重试耗尽后抛出最后一次错误。
 */
async function connectWithRetry(): Promise<void> {
  const cfg = config;
  if (!cfg) {
    throw new Error("RocketMQ config not set");
  }
  const maxAttempts = DEFAULT_RECONNECT_ATTEMPTS + 1;
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
      await sleep(DEFAULT_RECONNECT_DELAY_MS);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * @description 单次建立 Producer 与 PushConsumer 并注册 messageListener。
 * @param cfg - RocketMQ 配置。
 * @returns 连接完成后的 Promise。
 * @throws SDK startup 失败时抛出。
 */
async function connectOnce(cfg: RockermqConfig): Promise<void> {
  await teardownTransport();

  producer = new Producer({
    endpoints: cfg.endpoints,
    namespace: cfg.namespace,
    requestTimeout: cfg.producer.requestTimeout,
    sessionCredentials: cfg.sessionCredentials,
  });
  await producer.startup();

  consumer = new PushConsumer({
    endpoints: cfg.endpoints,
    namespace: cfg.namespace,
    consumerGroup: cfg.consumer.groupId,
    sessionCredentials: cfg.sessionCredentials,
    subscriptions: buildSubscriptions(cfg),
    maxCacheMessageCount: cfg.consumer.maxCacheMessageCount,
    maxCacheMessageSizeInBytes: cfg.consumer.maxCacheMessageSizeInBytes,
    longPollingTimeout: cfg.consumer.longPollingTimeout,
    requestTimeout: cfg.consumer.requestTimeout,
    messageListener: {
      async consume(messageView: MessageView): Promise<ConsumeResult> {
        if (!inboundHandler || !config) {
          return ConsumeResult.FAILURE;
        }
        const activeConfig = config;

        stats.messagesReceived++;
        stats.inFlight++;

        let disposition: InboundDisposition;
        try {
          disposition = await inboundHandler({
            topic: String(messageView.topic),
            tag: typeof messageView.tag === "string" ? messageView.tag : undefined,
            body: toMessageBuffer(messageView.body),
            keys: Array.isArray(messageView.keys) ? messageView.keys.map(String) : undefined,
            messageId:
              typeof messageView.messageId === "string" ? messageView.messageId : undefined,
            deliveryAttempt:
              typeof messageView.deliveryAttempt === "number"
                ? messageView.deliveryAttempt
                : undefined,
          });
        } catch (error) {
          stats.errors++;
          stats.lastError = error instanceof Error ? error.message : String(error);
          stats.inFlight = Math.max(0, stats.inFlight - 1);
          return activeConfig.consumer.reconsumeOnError
            ? ConsumeResult.FAILURE
            : ConsumeResult.SUCCESS;
        }

        stats.lastConsumeAt = Date.now();
        stats.inFlight = Math.max(0, stats.inFlight - 1);

        if (disposition.ok) {
          stats.messagesAcked++;
          return ConsumeResult.SUCCESS;
        }
        if (disposition.reconsume ?? activeConfig.consumer.reconsumeOnError) {
          stats.messagesNacked++;
          stats.messagesRequeued++;
          return ConsumeResult.FAILURE;
        }
        stats.messagesNacked++;
        return ConsumeResult.SUCCESS;
      },
    },
  });

  await consumer.startup();
  stats.connected = true;
  stats.lastConnectAt = Date.now();
  stats.lastError = null;
}

/**
 * @description 合并 consumer.subscriptions 与 topicBindings 构建 PushConsumer 订阅表。
 * @param cfg - RocketMQ 配置。
 * @returns topic → filterExpression 映射。
 * @throws 不抛出。
 */
function buildSubscriptions(cfg: RockermqConfig): Map<string, string> {
  const subscriptions = new Map<string, string>();
  for (const item of cfg.consumer.subscriptions) {
    subscriptions.set(item.topic, item.filterExpression || "*");
  }
  for (const item of cfg.topicBindings) {
    if (!subscriptions.has(item.topic)) {
      subscriptions.set(item.topic, item.tag || "*");
    }
  }
  if (subscriptions.size === 0) {
    subscriptions.set(`${cfg.topicPrefix}.agent.default.in`, "*");
  }
  return subscriptions;
}

/**
 * @description 异步 sleep 工具（重连退避）。
 * @param ms - 毫秒数。
 * @returns 延迟 resolve 的 Promise。
 * @throws 不抛出。
 */
function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @description 将 SDK body 转为 Buffer，避免对已是 Buffer 的载荷重复拷贝。
 */
function toMessageBuffer(body: unknown): Buffer {
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }
  if (typeof body === "string") {
    return Buffer.from(body);
  }
  return Buffer.from(String(body ?? ""));
}

/**
 * @description 关闭现有 Producer/Consumer 引用，便于重连前清理。
 */
async function teardownTransport(): Promise<void> {
  try {
    if (consumer) {
      await consumer.shutdown();
    }
  } catch {
    // shutdown errors are non-fatal
  } finally {
    consumer = null;
  }

  try {
    if (producer) {
      await producer.shutdown();
    }
  } catch {
    // shutdown errors are non-fatal
  } finally {
    producer = null;
  }

  stats.connected = false;
  stats.lastDisconnectAt = Date.now();
}
