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

import {
  ConsumeResult,
  ExponentialBackoffRetryPolicy,
  Producer,
  PushConsumer,
  type MessageView,
} from "rocketmq-client-nodejs";
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
  messagesDropped: number;
  messagesDeadLettered: number;
  lastDropReason: string | null;
  errors: number;
  inFlight: number;
};

let producer: Producer | null = null;
let consumer: PushConsumer | null = null;
let config: RockermqConfig | null = null;
let inboundHandler: InboundHandler | null = null;
let stopping = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let startupPromise: Promise<void> | null = null;
const ROCKETMQ_STATUS_OK = 20_000;

/**
 * The Node SDK currently ignores Broker `CUSTOMIZED_BACKOFF` settings, leaving
 * non-FIFO nack invisible duration at zero. Pin a configured policy so FAILURE
 * always results in a valid delayed redelivery and exposes a deterministic
 * max-attempt value to DLQ forwarding.
 */
class CompatiblePushConsumer extends PushConsumer {
  constructor(
    options: ConstructorParameters<typeof PushConsumer>[0],
    private readonly configuredRetryPolicy: SafeExponentialBackoffRetryPolicy,
  ) {
    super(options);
  }

  override getRetryPolicy(): SafeExponentialBackoffRetryPolicy {
    return this.configuredRetryPolicy;
  }
}

/** RocketMQ 5 may report the first non-FIFO delivery as attempt 0. */
class SafeExponentialBackoffRetryPolicy extends ExponentialBackoffRetryPolicy {
  override getNextAttemptDelay(attempt: number): number {
    return super.getNextAttemptDelay(Math.max(1, attempt));
  }
}

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
  messagesDropped: 0,
  messagesDeadLettered: 0,
  lastDropReason: null,
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
  abortSignal?: AbortSignal,
): Promise<void> {
  if (startupPromise || producer || consumer) {
    throw new Error("RocketMQ transport is already started or starting");
  }
  config = cfg;
  inboundHandler = handler;
  stopping = false;
  startupPromise = connectWithRetry(abortSignal);
  try {
    await startupPromise;
    if (abortSignal?.aborted) {
      config = null;
      inboundHandler = null;
    }
  } catch (error) {
    await teardownTransport();
    config = null;
    inboundHandler = null;
    throw error;
  } finally {
    startupPromise = null;
  }
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
  config = null;
  inboundHandler = null;
  startupPromise = null;
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
    maxAttempts: config?.producer.maxAttempts ?? 3,
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
 * @description 记录永久入站丢弃原因，不污染连接健康状态。
 * @param reason - 丢弃原因码。
 * @returns void
 * @throws 不抛出。
 */
export function trackInboundDropped(reason: string): void {
  stats.messagesDropped++;
  stats.lastDropReason = reason;
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
 * @description 按 connection 配置进行启动重试。
 * @returns 连接成功后的 Promise。
 * @throws 重试耗尽后抛出最后一次错误。
 */
async function connectWithRetry(abortSignal?: AbortSignal): Promise<void> {
  const cfg = config;
  if (!cfg) {
    throw new Error("RocketMQ config not set");
  }
  const maxAttempts = cfg.connection.startupAttempts;
  let attempt = 0;
  let lastErr: unknown = null;

  while (!stopping && !abortSignal?.aborted && attempt < maxAttempts) {
    attempt++;
    try {
      await connectOnce(cfg);
      if (stopping || abortSignal?.aborted) {
        await teardownTransport();
      }
      return;
    } catch (err) {
      if (stopping || abortSignal?.aborted) {
        await teardownTransport();
        return;
      }
      lastErr = err;
      stats.errors++;
      stats.lastError = err instanceof Error ? err.message : String(err);
      if (attempt >= maxAttempts) {
        break;
      }
      await sleep(cfg.connection.retryDelayMs, abortSignal);
    }
  }
  if (stopping || abortSignal?.aborted) {
    await teardownTransport();
    return;
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
    maxAttempts: cfg.producer.maxAttempts,
    sessionCredentials: cfg.sessionCredentials,
  });
  await producer.startup();

  const retry = cfg.consumer.retry;
  consumer = new CompatiblePushConsumer({
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
          const deliveryAttempt = Math.max(
            1,
            typeof messageView.deliveryAttempt === "number" ? messageView.deliveryAttempt : 1,
          );
          if (deliveryAttempt >= activeConfig.consumer.retry.maxAttempts) {
            try {
              await forwardToDeadLetterQueue(messageView);
              stats.messagesDeadLettered++;
              return ConsumeResult.SUCCESS;
            } catch (error) {
              stats.errors++;
              stats.lastError = error instanceof Error ? error.message : String(error);
            }
          }
          stats.messagesRequeued++;
          return ConsumeResult.FAILURE;
        }
        stats.messagesNacked++;
        return ConsumeResult.SUCCESS;
      },
    },
  }, new SafeExponentialBackoffRetryPolicy(
    retry.maxAttempts,
    retry.initialDelayMs,
    retry.maxDelayMs,
    retry.multiplier,
  ));

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
function sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
  if (ms <= 0 || abortSignal?.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const finish = (): void => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      abortSignal?.removeEventListener("abort", finish);
      resolve();
    };
    reconnectTimer = setTimeout(finish, ms);
    abortSignal?.addEventListener("abort", finish, { once: true });
  });
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

/** Forward a message explicitly because the Node SDK only performs this check for FIFO queues. */
async function forwardToDeadLetterQueue(messageView: MessageView): Promise<void> {
  const activeConsumer = consumer;
  if (!activeConsumer) {
    throw new Error("RocketMQ consumer is not initialized for DLQ forwarding");
  }
  const response = await activeConsumer.forwardMessageToDeadLetterQueueViaRpc(
    messageView.endpoints,
    activeConsumer.wrapForwardMessageToDeadLetterQueueRequest(messageView),
    activeConsumer.requestTimeoutValue,
  );
  const status = response.getStatus()?.toObject();
  if (status?.code !== ROCKETMQ_STATUS_OK) {
    throw new Error(`RocketMQ DLQ forwarding failed: ${status?.message ?? "unknown status"}`);
  }
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
