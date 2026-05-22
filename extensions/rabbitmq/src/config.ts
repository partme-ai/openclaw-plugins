export interface TopicBinding {
  topicPattern: string;
  agentId: string;
  accountId: string;
  replyTopicPattern?: string;
}

export type DispatchMode = "reply-pipeline" | "embedded-agent" | "subagent";

export type RabbitmqConfig = {
  url: string;
  exchange: string;
  exchangeType: "topic" | "direct" | "fanout" | "headers";
  exchangeDurable: boolean;
  topicPrefix: string;
  subscribeTopics: string[];
  topicBindings: TopicBinding[];
  payload: {
    mode: "jsonTextOrPlain" | "jsonOnly" | "plainText";
    outboundFormat?: "envelope" | "legacyJsonText" | "plainText";
  };
  queue: {
    name?: string;
    durable: boolean;
    exclusive: boolean;
    autoDelete: boolean;
    quorum: boolean;
  };
  retry: {
    enabled: boolean;
    delayMs: number;
    maxAttempts: number;
    queueSuffix: string;
  };
  connection: {
    timeoutMs: number;
    heartbeatSeconds: number;
    reconnectAttempts: number;
    reconnectDelayMs: number;
  };
  consume: {
    prefetch: number;
    concurrency: number;
    requeueOnError: boolean;
  };
  dispatch: {
    mode: DispatchMode;
    timeoutMs: number;
    reply: {
      enabled: boolean;
    };
  };
  idempotency: {
    enabled: boolean;
    ttlMs: number;
    maxEntries: number;
  };
};

/**
 * 默认配置
 */
export const DEFAULT_RABBITMQ_CONFIG: RabbitmqConfig = {
  url: "amqp://localhost",
  exchange: "openclaw",
  exchangeType: "topic",
  exchangeDurable: true,
  topicPrefix: "openclaw",
  topicBindings: [],
  subscribeTopics: [],
  payload: {
    mode: "jsonTextOrPlain",
  },
  queue: {
    name: undefined,
    durable: true,
    exclusive: false,
    autoDelete: false,
    quorum: false,
  },
  retry: {
    enabled: false,
    delayMs: 5000,
    maxAttempts: 5,
    queueSuffix: ".retry",
  },
  connection: {
    timeoutMs: 30000,
    heartbeatSeconds: 30,
    reconnectAttempts: 5,
    reconnectDelayMs: 5000,
  },
  consume: {
    prefetch: 50,
    concurrency: 4,
    requeueOnError: true,
  },
  dispatch: {
    mode: "embedded-agent",
    timeoutMs: 120000,
    reply: {
      enabled: true,
    },
  },
  idempotency: {
    enabled: false,
    ttlMs: 10 * 60_000,
    maxEntries: 10_000,
  },
};

/**
 * 从运行时配置解析 RabbitMQ 配置。
 */
export function resolveRabbitmqConfig(cfg: Record<string, unknown>): RabbitmqConfig {
  const channels = (cfg.channels as Record<string, unknown> | undefined) ?? undefined;
  const rabbitmqConfig =
    (channels?.rabbitmq as Record<string, unknown> | null | undefined) ??
    ((cfg.rabbitmq as Record<string, unknown> | null | undefined) ?? {});
  const payload = (rabbitmqConfig.payload as Record<string, unknown> | null | undefined) ?? {};
  const connection = (rabbitmqConfig.connection as Record<string, unknown> | null | undefined) ?? {};
  const consume = (rabbitmqConfig.consume as Record<string, unknown> | null | undefined) ?? {};
  const dispatch = (rabbitmqConfig.dispatch as Record<string, unknown> | null | undefined) ?? {};
  const dispatchReply = (dispatch.reply as Record<string, unknown> | null | undefined) ?? {};
  const idempotency = (rabbitmqConfig.idempotency as Record<string, unknown> | null | undefined) ?? {};
  const queue = (rabbitmqConfig.queue as Record<string, unknown> | null | undefined) ?? {};
  const retry = (rabbitmqConfig.retry as Record<string, unknown> | null | undefined) ?? {};

  const exchangeTypeRaw = rabbitmqConfig.exchangeType ?? DEFAULT_RABBITMQ_CONFIG.exchangeType;
  const exchangeType =
    exchangeTypeRaw === "direct" ||
    exchangeTypeRaw === "fanout" ||
    exchangeTypeRaw === "headers" ||
    exchangeTypeRaw === "topic"
      ? exchangeTypeRaw
      : DEFAULT_RABBITMQ_CONFIG.exchangeType;

  const payloadModeRaw = payload.mode ?? DEFAULT_RABBITMQ_CONFIG.payload.mode;
  const payloadMode =
    payloadModeRaw === "jsonOnly" || payloadModeRaw === "plainText" || payloadModeRaw === "jsonTextOrPlain"
      ? payloadModeRaw
      : DEFAULT_RABBITMQ_CONFIG.payload.mode;

  const dispatchModeRaw = dispatch.mode ?? DEFAULT_RABBITMQ_CONFIG.dispatch.mode;
  const dispatchMode: DispatchMode =
    dispatchModeRaw === "reply-pipeline" || dispatchModeRaw === "embedded-agent" || dispatchModeRaw === "subagent"
      ? dispatchModeRaw
      : DEFAULT_RABBITMQ_CONFIG.dispatch.mode;

  return {
    url: String(rabbitmqConfig.url ?? DEFAULT_RABBITMQ_CONFIG.url),
    exchange: String(rabbitmqConfig.exchange ?? DEFAULT_RABBITMQ_CONFIG.exchange),
    exchangeType,
    exchangeDurable: rabbitmqConfig.exchangeDurable !== false,
    topicPrefix: String(rabbitmqConfig.topicPrefix ?? DEFAULT_RABBITMQ_CONFIG.topicPrefix),
    topicBindings: Array.isArray(rabbitmqConfig.topicBindings) 
      ? rabbitmqConfig.topicBindings.map((b: any) => ({
          topicPattern: String(b.topicPattern ?? ""),
          agentId: String(b.agentId ?? ""),
          accountId: String(b.accountId ?? "default"),
          replyTopicPattern: b.replyTopicPattern ? String(b.replyTopicPattern) : undefined,
        }))
      : DEFAULT_RABBITMQ_CONFIG.topicBindings,
    subscribeTopics: Array.isArray(rabbitmqConfig.subscribeTopics)
      ? rabbitmqConfig.subscribeTopics.map(String)
      : DEFAULT_RABBITMQ_CONFIG.subscribeTopics,
    payload: {
      mode: payloadMode,
      outboundFormat:
        payload.outboundFormat === "envelope" ||
        payload.outboundFormat === "legacyJsonText" ||
        payload.outboundFormat === "plainText"
          ? payload.outboundFormat
          : undefined,
    },
    queue: {
      name: typeof queue.name === "string" && queue.name.trim().length > 0 ? queue.name.trim() : undefined,
      durable: queue.durable !== false,
      exclusive: queue.exclusive === true,
      autoDelete: queue.autoDelete === true,
      quorum: queue.quorum === true,
    },
    retry: {
      enabled: retry.enabled === true,
      delayMs:
        typeof retry.delayMs === "number" && retry.delayMs > 0
          ? retry.delayMs
          : DEFAULT_RABBITMQ_CONFIG.retry.delayMs,
      maxAttempts:
        typeof retry.maxAttempts === "number" && retry.maxAttempts >= 0
          ? retry.maxAttempts
          : DEFAULT_RABBITMQ_CONFIG.retry.maxAttempts,
      queueSuffix:
        typeof retry.queueSuffix === "string" && retry.queueSuffix.trim().length > 0
          ? retry.queueSuffix.trim()
          : DEFAULT_RABBITMQ_CONFIG.retry.queueSuffix,
    },
    connection: {
      timeoutMs:
        typeof connection.timeoutMs === "number" && connection.timeoutMs > 0
          ? connection.timeoutMs
          : DEFAULT_RABBITMQ_CONFIG.connection.timeoutMs,
      heartbeatSeconds:
        typeof connection.heartbeatSeconds === "number" && connection.heartbeatSeconds >= 0
          ? connection.heartbeatSeconds
          : DEFAULT_RABBITMQ_CONFIG.connection.heartbeatSeconds,
      reconnectAttempts:
        typeof connection.reconnectAttempts === "number" && connection.reconnectAttempts >= 0
          ? connection.reconnectAttempts
          : DEFAULT_RABBITMQ_CONFIG.connection.reconnectAttempts,
      reconnectDelayMs:
        typeof connection.reconnectDelayMs === "number" && connection.reconnectDelayMs >= 0
          ? connection.reconnectDelayMs
          : DEFAULT_RABBITMQ_CONFIG.connection.reconnectDelayMs,
    },
    consume: {
      prefetch:
        typeof consume.prefetch === "number" && consume.prefetch >= 0
          ? consume.prefetch
          : DEFAULT_RABBITMQ_CONFIG.consume.prefetch,
      concurrency:
        typeof consume.concurrency === "number" && consume.concurrency > 0
          ? consume.concurrency
          : DEFAULT_RABBITMQ_CONFIG.consume.concurrency,
      requeueOnError: consume.requeueOnError !== false,
    },
    dispatch: {
      mode: dispatchMode,
      timeoutMs:
        typeof dispatch.timeoutMs === "number" && dispatch.timeoutMs > 0
          ? dispatch.timeoutMs
          : DEFAULT_RABBITMQ_CONFIG.dispatch.timeoutMs,
      reply: {
        enabled: dispatchReply.enabled !== false,
      },
    },
    idempotency: {
      enabled: idempotency.enabled === true,
      ttlMs:
        typeof idempotency.ttlMs === "number" && idempotency.ttlMs > 0
          ? idempotency.ttlMs
          : DEFAULT_RABBITMQ_CONFIG.idempotency.ttlMs,
      maxEntries:
        typeof idempotency.maxEntries === "number" && idempotency.maxEntries > 0
          ? idempotency.maxEntries
          : DEFAULT_RABBITMQ_CONFIG.idempotency.maxEntries,
    },
  };
}

/**
 * 验证 RabbitMQ 配置。
 */
export function validateRabbitmqConfig(config: RabbitmqConfig): string[] {
  const issues: string[] = [];
  if (!config.url) {
    issues.push("RabbitMQ URL is required");
  }
  if (!config.exchange) {
    issues.push("RabbitMQ exchange name is required");
  }
  if (!config.topicPrefix) {
    issues.push("RabbitMQ topicPrefix is required");
  }
  for (const binding of config.topicBindings) {
    if (!binding.topicPattern) {
      issues.push("topicBindings: topicPattern is required");
    }
    if (!binding.agentId) {
      issues.push("topicBindings: agentId is required");
    }
  }
  return issues;
}

/**
 * 构建 RabbitMQ 配置快照。
 */
export function buildRabbitmqConfigSnapshot(config: RabbitmqConfig): Record<string, unknown> {
  return {
    url: config.url,
    exchange: config.exchange,
    exchangeType: config.exchangeType,
    exchangeDurable: config.exchangeDurable,
    topicPrefix: config.topicPrefix,
    topicBindings: config.topicBindings,
    subscribeTopics: config.subscribeTopics,
    payload: config.payload,
    queue: config.queue,
    retry: config.retry,
    connection: config.connection,
    consume: config.consume,
    dispatch: config.dispatch,
    idempotency: config.idempotency,
  };
}
