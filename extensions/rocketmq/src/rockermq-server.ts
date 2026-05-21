/**
 * RocketMQ 传输层封装。
 * 封装 rocketmq-client-nodejs Producer 与 PushConsumer，
 * 提供连接管理、自动重连与状态上报。
 */

import { ConsumeResult, Producer, PushConsumer, type MessageView } from "rocketmq-client-nodejs";
import type { RockermqConfig } from "./rocketmq-config.js";

export type InboundEvent = {
  topic: string;
  tag?: string;
  body: Buffer;
  keys?: string[];
  messageId?: string;
  deliveryAttempt?: number;
};

export type InboundDisposition = { ok: true } | { ok: false; reconsume?: boolean; reason?: string };

export type InboundHandler = (event: InboundEvent) => Promise<InboundDisposition>;

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
 * 启动 RocketMQ producer / push consumer。
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
 * 关闭 RocketMQ 客户端。
 */
export async function stopRockermqServer(): Promise<void> {
  stopping = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

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

/**
 * 发送 RocketMQ 消息。
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
 * 读取当前统计。
 */
export function getStats(): RockermqStats {
  return { ...stats };
}

/**
 * 入站追踪函数。
 */
export function trackInboundAccepted(): void {
  // accepted counts are tracked via messagesReceived + messagesAcked
}

export function trackInboundDropped(reason: string): void {
  stats.errors++;
  stats.lastError = `inbound_dropped:${reason}`;
}

export function trackRoute(_source: string): void {
  // route tracking for diagnostics
}

// ─────────────── 内部实现 ───────────────

async function connectWithRetry(): Promise<void> {
  const cfg = config;
  if (!cfg) {
    throw new Error("RocketMQ config not set");
  }
  const maxAttempts = 5;
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
      await sleep(5000);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function connectOnce(cfg: RockermqConfig): Promise<void> {
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
            body: Buffer.from(messageView.body),
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
 * 构建订阅集合。
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
