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
import { DEFAULT_ROCKERMQ_CONFIG, type RockermqConfig } from "../config.js";

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
export type InboundDisposition =
  | { ok: true }
  | { ok: false; reconsume?: boolean; reason?: string };

/** @description 入站消息处理器类型。 */
export type InboundHandler = (
  event: InboundEvent,
) => Promise<InboundDisposition>;

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
const DEFAULT_MAX_MESSAGE_SIZE_IN_BYTES = 4 * 1024 * 1024;

/**
 * Node SDK 当前会忽略 Broker 的 `CUSTOMIZED_BACKOFF` 配置，导致非 FIFO 消息
 * NACK 后的不可见时间可能为 0。这里固定使用插件配置的退避策略，保证 FAILURE
 * 总能得到有效的延迟重投，同时为 DLQ 转发提供确定的最大尝试次数。
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

/** RocketMQ 5 可能把非 FIFO 消息第一次投递的 attempt 报为 0，因此统一修正为至少 1。 */
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
  maxMessageSizeInBytes?: number;
  sessionCredentials?: RockermqConfig["sessionCredentials"];
}): Promise<unknown> {
  if (!params.topic.trim()) {
    throw new Error("RocketMQ publish topic is required");
  }
  const body = Buffer.from(params.payload);
  const maxMessageSizeInBytes =
    params.maxMessageSizeInBytes ??
    config?.producer.maxMessageSizeInBytes ??
    DEFAULT_MAX_MESSAGE_SIZE_IN_BYTES;
  if (body.byteLength > maxMessageSizeInBytes) {
    throw new Error(
      `RocketMQ payload exceeds producer.maxMessageSizeInBytes (${body.byteLength} > ${maxMessageSizeInBytes})`,
    );
  }
  if (producer) {
    const receipt = await producer.send({
      topic: params.topic,
      tag: params.tag,
      keys: params.keys,
      body,
    });
    stats.messagesSent++;
    return receipt;
  }

  // 子 Agent / 子进程无法复用主进程长连接时，创建仅发送一次的临时 Producer。
  const endpoints = params.endpoints ?? config?.endpoints;
  if (!endpoints) {
    throw new Error("RocketMQ endpoints not available");
  }
  const oneShot = new Producer({
    endpoints,
    namespace: params.namespace ?? config?.namespace ?? "",
    requestTimeout:
      params.requestTimeout ?? config?.producer?.requestTimeout ?? 5000,
    maxAttempts: config?.producer.maxAttempts ?? 3,
    sessionCredentials: params.sessionCredentials ?? config?.sessionCredentials,
  });
  try {
    await oneShot.startup();
    const receipt = await oneShot.send({
      topic: params.topic,
      tag: params.tag,
      keys: params.keys,
      body,
    });
    stats.messagesSent++;
    return receipt;
  } finally {
    // send 的结果比临时客户端清理更重要：shutdown 失败要进入诊断统计，但不能覆盖
    // 已经成功取得的 Broker receipt，也不能把原始 send 异常替换成次生异常。
    try {
      await withTimeout(
        oneShot.shutdown(),
        config?.connection.shutdownTimeoutMs ??
          DEFAULT_ROCKERMQ_CONFIG.connection.shutdownTimeoutMs,
        "RocketMQ one-shot producer shutdown",
      );
    } catch (error) {
      recordError(error);
    }
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
  // 接受数量由 messagesReceived 与 messagesAcked 的组合体现，暂不重复维护计数器。
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
  // 保留诊断扩展点，后续可按 binding / standard 统计路由来源。
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
      stats.lastError = formatError(err);
      if (attempt >= maxAttempts) {
        break;
      }
      await sleep(
        computeStartupRetryDelay(
          cfg.connection.retryDelayMs,
          cfg.connection.retryMaxDelayMs,
          cfg.connection.retryJitterRatio,
          attempt,
        ),
        abortSignal,
      );
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
  consumer = new CompatiblePushConsumer(
    {
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
              tag:
                typeof messageView.tag === "string"
                  ? messageView.tag
                  : undefined,
              body: toMessageBuffer(messageView.body),
              keys: Array.isArray(messageView.keys)
                ? messageView.keys.map(String)
                : undefined,
              messageId:
                typeof messageView.messageId === "string"
                  ? messageView.messageId
                  : undefined,
              deliveryAttempt:
                typeof messageView.deliveryAttempt === "number"
                  ? messageView.deliveryAttempt
                  : undefined,
            });
          } catch (error) {
            recordError(error);
            if (activeConfig.consumer.reconsumeOnError) {
              // 抛异常和 handler 显式返回 reconsume=true 必须进入同一状态机；否则异常路径
              // 会绕过 maxAttempts/DLQ，非 FIFO 毒消息可能永久重投。
              disposition = {
                ok: false,
                reconsume: true,
                reason: "inbound_handler_error",
              };
            } else {
              // 明确关闭重消费意味着“记录并确认丢弃”，否则 Broker 会认为成功，
              // 但运维指标里既看不到 ACK，也看不到消息为何消失。
              stats.messagesDropped++;
              stats.lastDropReason = "inbound_handler_error";
              disposition = {
                ok: false,
                reconsume: false,
                reason: "inbound_handler_error",
              };
            }
          } finally {
            stats.lastConsumeAt = Date.now();
            stats.inFlight = Math.max(0, stats.inFlight - 1);
          }

          if (disposition.ok) {
            stats.messagesAcked++;
            return ConsumeResult.SUCCESS;
          }
          if (disposition.reconsume ?? activeConfig.consumer.reconsumeOnError) {
            const deliveryAttempt = Math.max(
              1,
              typeof messageView.deliveryAttempt === "number"
                ? messageView.deliveryAttempt
                : 1,
            );
            if (deliveryAttempt >= activeConfig.consumer.retry.maxAttempts) {
              try {
                await forwardToDeadLetterQueue(messageView);
                stats.messagesDeadLettered++;
                stats.messagesAcked++;
                return ConsumeResult.SUCCESS;
              } catch (error) {
                recordError(error);
              }
            }
            markBrokerReconsume();
            return ConsumeResult.FAILURE;
          }
          // 永久性拒绝由 channel 层通过 trackInboundDropped 记录业务原因；传输层仍需
          // 对 Broker 返回 SUCCESS，防止无路由/空载荷形成永不终止的毒消息循环。
          stats.messagesAcked++;
          return ConsumeResult.SUCCESS;
        },
      },
    },
    new SafeExponentialBackoffRetryPolicy(
      retry.maxAttempts,
      retry.initialDelayMs,
      retry.maxDelayMs,
      retry.multiplier,
    ),
  );

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
    const prefix = cfg.topicPrefix ? `${cfg.topicPrefix}--agent--` : "agent--";
    subscriptions.set(`${prefix}default--in`, "*");
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
    reconnectTimer.unref?.();
    abortSignal?.addEventListener("abort", finish, { once: true });
  });
}

/**
 * 计算第 `failedAttempt` 次启动失败后的指数退避，并加入对称抖动。
 *
 * 将计算导出是为了让“不会形成重连风暴”成为可单测的契约；`random=0.5`
 * 时抖动为零，便于测试锁定纯指数序列。
 */
export function computeStartupRetryDelay(
  baseDelayMs: number,
  maxDelayMs: number,
  jitterRatio: number,
  failedAttempt: number,
  random: () => number = Math.random,
): number {
  if (baseDelayMs <= 0) {
    return 0;
  }
  const exponential = Math.min(
    maxDelayMs,
    baseDelayMs * 2 ** Math.max(0, failedAttempt - 1),
  );
  const jitter = exponential * jitterRatio * (random() * 2 - 1);
  return Math.max(0, Math.round(exponential + jitter));
}

/** Broker FAILURE 的两个指标必须同步递增，避免 NACK 与重投数量相互矛盾。 */
function markBrokerReconsume(): void {
  stats.messagesNacked++;
  stats.messagesRequeued++;
}

/** 集中记录传输错误，避免不同分支遗漏 errors/lastError。 */
function recordError(error: unknown): void {
  stats.errors++;
  stats.lastError = formatError(error);
}

/** 诊断只保留单行错误摘要，避免控制字符污染日志或状态接口。 */
function formatError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(
    /[\r\n\t]/g,
    " ",
  );
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

/** Node SDK 只对 FIFO 队列执行耗尽检查，因此非 FIFO 消息需要在这里显式转入 Broker DLQ。 */
async function forwardToDeadLetterQueue(
  messageView: MessageView,
): Promise<void> {
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
    throw new Error(
      `RocketMQ DLQ forwarding failed: ${status?.message ?? "unknown status"}`,
    );
  }
}

/**
 * @description 关闭现有 Producer/Consumer 引用，便于重连前清理。
 */
async function teardownTransport(): Promise<void> {
  const timeoutMs =
    config?.connection.shutdownTimeoutMs ??
    DEFAULT_ROCKERMQ_CONFIG.connection.shutdownTimeoutMs;
  try {
    if (consumer) {
      await withTimeout(
        consumer.shutdown(),
        timeoutMs,
        "RocketMQ consumer shutdown",
      );
    }
  } catch (error) {
    // 关闭 Consumer 失败或超时不阻断 Producer 清理；错误仍进入健康诊断。
    recordError(error);
  } finally {
    consumer = null;
  }

  try {
    if (producer) {
      await withTimeout(
        producer.shutdown(),
        timeoutMs,
        "RocketMQ producer shutdown",
      );
    }
  } catch (error) {
    // 关闭 Producer 失败或超时不阻断账户停止流程，防止 Gateway 无法退出。
    recordError(error);
  } finally {
    producer = null;
  }

  stats.connected = false;
  stats.lastDisconnectAt = Date.now();
}

/** 固定时间预算包装器：SDK 未及时返回时放弃等待，避免账户停止永久挂起。 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
