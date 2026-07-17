/**
 * @fileoverview RabbitMQ 配置类型、默认值与 openclaw.json 解析/校验。
 *
 * @description
 * Base Profile 平铺 `config.ts` 入口：定义 `RabbitmqConfig` 形状、默认常量，
 * 以及从宿主运行时配置解析、校验与快照序列化的工具函数。
 *
 * @module config
 */

/** @description Topic 与 Agent 的显式绑定规则（routing key 模式 → agentId/accountId）。 */
export interface TopicBinding {
  topicPattern: string;
  agentId: string;
  accountId: string;
  replyTopicPattern?: string;
}

/** @description 入站消息分发至 OpenClaw 的模式（reply 管线 / 内嵌 Agent / 子 Agent）。 */
export type DispatchMode = "reply-pipeline" | "embedded-agent" | "subagent";

/** @description RabbitMQ Channel 完整运行时配置（与 `channels.rabbitmq` 对齐）。 */
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
    deadLetterSuffix: string;
  };
  connection: {
    /**
     * 是否允许远程 RabbitMQ 使用明文 AMQP。
     *
     * 本地开发的 localhost/回环地址不受此开关限制；生产远程地址默认必须使用 amqps，
     * 避免用户名、密码和业务消息在网络中明文传输。
     */
    allowInsecureRemote: boolean;
    timeoutMs: number;
    heartbeatSeconds: number;
    reconnectAttempts: number;
    reconnectDelayMs: number;
    /** 指数退避的最大等待时间，防止持续故障时高频冲击 Broker。 */
    reconnectMaxDelayMs: number;
    /** 重连抖动比例（0~1），用于降低多 Gateway 实例同时重连造成的惊群。 */
    reconnectJitterRatio: number;
    publishConfirmTimeoutMs: number;
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

/** @description RabbitMQ Channel 默认配置常量（未在 openclaw.json 中覆盖时使用）。 */
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
    name: "openclaw.rabbitmq",
    durable: true,
    exclusive: false,
    autoDelete: false,
    quorum: false,
  },
  retry: {
    enabled: true,
    delayMs: 5000,
    maxAttempts: 5,
    queueSuffix: ".retry",
    deadLetterSuffix: ".dlq",
  },
  connection: {
    allowInsecureRemote: false,
    timeoutMs: 30000,
    heartbeatSeconds: 30,
    reconnectAttempts: 5,
    reconnectDelayMs: 5000,
    reconnectMaxDelayMs: 60000,
    reconnectJitterRatio: 0.2,
    publishConfirmTimeoutMs: 10000,
  },
  consume: {
    prefetch: 50,
    concurrency: 4,
    requeueOnError: false,
  },
  dispatch: {
    mode: "embedded-agent",
    timeoutMs: 120000,
    reply: {
      enabled: true,
    },
  },
  idempotency: {
    enabled: true,
    ttlMs: 10 * 60_000,
    maxEntries: 10_000,
  },
};

/**
 * 判断用户是否显式配置了非空 RabbitMQ URL。
 *
 * 同时兼容当前的 `channels.rabbitmq` 和旧版根级 `rabbitmq` 配置，但不注入默认地址；因此该
 * 结果可以安全用于 setup 状态判断，不会把“尚未配置”误报为“已配置”。
 */
export function isRabbitmqConfigured(cfg: Record<string, unknown> | undefined | null): boolean {
  const root = cfg ?? {};
  const channels = root.channels as Record<string, unknown> | undefined;
  const value = channels?.rabbitmq ?? root.rabbitmq;
  if (!value || typeof value !== "object") return false;
  const url = (value as Record<string, unknown>).url;
  return typeof url === "string" && url.trim().length > 0;
}

/**
 * @description 从宿主运行时 openclaw.json 解析 RabbitMQ 通道配置。
 * @param cfg - 宿主全局配置对象（含 `channels.rabbitmq` 或顶层 `rabbitmq`）
 * @returns 合并默认值后的完整 `RabbitmqConfig`
 */
export function resolveRabbitmqConfig(cfg: Record<string, unknown> | undefined | null): RabbitmqConfig {
  const root = cfg ?? {};
  const channels = (root.channels as Record<string, unknown> | undefined) ?? undefined;
  const rabbitmqConfig =
    (channels?.rabbitmq as Record<string, unknown> | null | undefined) ??
    ((root.rabbitmq as Record<string, unknown> | null | undefined) ?? {});
  const payload = (rabbitmqConfig.payload as Record<string, unknown> | null | undefined) ?? {};
  const connection = (rabbitmqConfig.connection as Record<string, unknown> | null | undefined) ?? {};
  const consume = (rabbitmqConfig.consume as Record<string, unknown> | null | undefined) ?? {};
  const dispatch = (rabbitmqConfig.dispatch as Record<string, unknown> | null | undefined) ?? {};
  const dispatchReply = (dispatch.reply as Record<string, unknown> | null | undefined) ?? {};
  const idempotency = (rabbitmqConfig.idempotency as Record<string, unknown> | null | undefined) ?? {};
  const queue = (rabbitmqConfig.queue as Record<string, unknown> | null | undefined) ?? {};
  const retry = (rabbitmqConfig.retry as Record<string, unknown> | null | undefined) ?? {};

  /*
   * 显式写错的配置不能静默退回默认值。这里先保留原值，统一交给 validateRabbitmqConfig
   * 生成可诊断错误；否则用户以为 direct 生效，插件却悄悄按 topic 运行，风险更大。
   */
  const exchangeType = String(
    rabbitmqConfig.exchangeType ?? DEFAULT_RABBITMQ_CONFIG.exchangeType,
  ) as RabbitmqConfig["exchangeType"];

  const payloadMode = String(
    payload.mode ?? DEFAULT_RABBITMQ_CONFIG.payload.mode,
  ) as RabbitmqConfig["payload"]["mode"];

  const dispatchMode = String(
    dispatch.mode ?? DEFAULT_RABBITMQ_CONFIG.dispatch.mode,
  ) as DispatchMode;

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
      ...(payload.outboundFormat === "envelope" ||
      payload.outboundFormat === "legacyJsonText" ||
      payload.outboundFormat === "plainText"
        ? { outboundFormat: payload.outboundFormat }
        : {}),
    },
    queue: {
      name:
        typeof queue.name === "string" && queue.name.trim().length > 0
          ? queue.name.trim()
          : DEFAULT_RABBITMQ_CONFIG.queue.name,
      durable: queue.durable !== false,
      exclusive: queue.exclusive === true,
      autoDelete: queue.autoDelete === true,
      quorum: queue.quorum === true,
    },
    retry: {
      enabled: retry.enabled !== false,
      delayMs:
        retry.delayMs === undefined
          ? DEFAULT_RABBITMQ_CONFIG.retry.delayMs
          : typeof retry.delayMs === "number" ? retry.delayMs : Number.NaN,
      maxAttempts:
        retry.maxAttempts === undefined
          ? DEFAULT_RABBITMQ_CONFIG.retry.maxAttempts
          : typeof retry.maxAttempts === "number" ? retry.maxAttempts : Number.NaN,
      queueSuffix:
        typeof retry.queueSuffix === "string" && retry.queueSuffix.trim().length > 0
          ? retry.queueSuffix.trim()
          : DEFAULT_RABBITMQ_CONFIG.retry.queueSuffix,
      deadLetterSuffix:
        typeof retry.deadLetterSuffix === "string" && retry.deadLetterSuffix.trim().length > 0
          ? retry.deadLetterSuffix.trim()
          : DEFAULT_RABBITMQ_CONFIG.retry.deadLetterSuffix,
    },
    connection: {
      allowInsecureRemote: connection.allowInsecureRemote === true,
      timeoutMs:
        connection.timeoutMs === undefined
          ? DEFAULT_RABBITMQ_CONFIG.connection.timeoutMs
          : typeof connection.timeoutMs === "number" ? connection.timeoutMs : Number.NaN,
      heartbeatSeconds:
        connection.heartbeatSeconds === undefined
          ? DEFAULT_RABBITMQ_CONFIG.connection.heartbeatSeconds
          : typeof connection.heartbeatSeconds === "number" ? connection.heartbeatSeconds : Number.NaN,
      reconnectAttempts:
        connection.reconnectAttempts === undefined
          ? DEFAULT_RABBITMQ_CONFIG.connection.reconnectAttempts
          : typeof connection.reconnectAttempts === "number" ? connection.reconnectAttempts : Number.NaN,
      reconnectDelayMs:
        connection.reconnectDelayMs === undefined
          ? DEFAULT_RABBITMQ_CONFIG.connection.reconnectDelayMs
          : typeof connection.reconnectDelayMs === "number" ? connection.reconnectDelayMs : Number.NaN,
      reconnectMaxDelayMs:
        connection.reconnectMaxDelayMs === undefined
          ? DEFAULT_RABBITMQ_CONFIG.connection.reconnectMaxDelayMs
          : typeof connection.reconnectMaxDelayMs === "number" ? connection.reconnectMaxDelayMs : Number.NaN,
      reconnectJitterRatio:
        connection.reconnectJitterRatio === undefined
          ? DEFAULT_RABBITMQ_CONFIG.connection.reconnectJitterRatio
          : typeof connection.reconnectJitterRatio === "number" ? connection.reconnectJitterRatio : Number.NaN,
      publishConfirmTimeoutMs:
        connection.publishConfirmTimeoutMs === undefined
          ? DEFAULT_RABBITMQ_CONFIG.connection.publishConfirmTimeoutMs
          : typeof connection.publishConfirmTimeoutMs === "number" ? connection.publishConfirmTimeoutMs : Number.NaN,
    },
    consume: {
      prefetch:
        consume.prefetch === undefined
          ? DEFAULT_RABBITMQ_CONFIG.consume.prefetch
          : typeof consume.prefetch === "number" ? consume.prefetch : Number.NaN,
      concurrency:
        consume.concurrency === undefined
          ? DEFAULT_RABBITMQ_CONFIG.consume.concurrency
          : typeof consume.concurrency === "number" ? consume.concurrency : Number.NaN,
      requeueOnError: consume.requeueOnError === true,
    },
    dispatch: {
      mode: dispatchMode,
      timeoutMs:
        dispatch.timeoutMs === undefined
          ? DEFAULT_RABBITMQ_CONFIG.dispatch.timeoutMs
          : typeof dispatch.timeoutMs === "number" ? dispatch.timeoutMs : Number.NaN,
      reply: {
        enabled: dispatchReply.enabled !== false,
      },
    },
    idempotency: {
      enabled: idempotency.enabled !== false,
      ttlMs:
        idempotency.ttlMs === undefined
          ? DEFAULT_RABBITMQ_CONFIG.idempotency.ttlMs
          : typeof idempotency.ttlMs === "number" ? idempotency.ttlMs : Number.NaN,
      maxEntries:
        idempotency.maxEntries === undefined
          ? DEFAULT_RABBITMQ_CONFIG.idempotency.maxEntries
          : typeof idempotency.maxEntries === "number" ? idempotency.maxEntries : Number.NaN,
    },
  };
}

/**
 * @description 校验 RabbitMQ 配置必填项与 topicBindings 完整性。
 * @param config - 已解析的配置对象
 * @returns 问题描述字符串数组；空数组表示通过
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
  if (config.queue.quorum && (config.queue.exclusive || config.queue.autoDelete || !config.queue.durable)) {
    issues.push("RabbitMQ quorum queue must be durable, non-exclusive, and non-auto-delete");
  }
  if (!config.queue.name && (config.queue.durable || config.queue.quorum)) {
    issues.push("RabbitMQ durable/quorum queue requires an explicit queue.name");
  }
  try {
    const url = new URL(config.url);
    if (url.protocol !== "amqp:" && url.protocol !== "amqps:") {
      issues.push("RabbitMQ URL protocol must be amqp:// or amqps://");
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
    if (url.protocol === "amqp:" && !local && !config.connection.allowInsecureRemote) {
      issues.push("Remote RabbitMQ must use amqps:// unless connection.allowInsecureRemote=true");
    }
  } catch {
    issues.push("RabbitMQ URL is invalid");
  }
  if (!["topic", "direct", "fanout", "headers"].includes(config.exchangeType)) {
    issues.push("RabbitMQ exchangeType must be topic, direct, fanout, or headers");
  }
  if (!["jsonTextOrPlain", "jsonOnly", "plainText"].includes(config.payload.mode)) {
    issues.push("RabbitMQ payload.mode is invalid");
  }
  if (!["reply-pipeline", "embedded-agent", "subagent"].includes(config.dispatch.mode)) {
    issues.push("RabbitMQ dispatch.mode is invalid");
  }
  const requireInteger = (value: number, minimum: number, name: string): void => {
    if (!Number.isInteger(value) || value < minimum) {
      issues.push(`${name} must be an integer >= ${minimum}`);
    }
  };
  requireInteger(config.retry.delayMs, 1, "retry.delayMs");
  requireInteger(config.retry.maxAttempts, 0, "retry.maxAttempts");
  requireInteger(config.connection.timeoutMs, 1, "connection.timeoutMs");
  requireInteger(config.connection.heartbeatSeconds, 0, "connection.heartbeatSeconds");
  requireInteger(config.connection.reconnectAttempts, 0, "connection.reconnectAttempts");
  requireInteger(config.connection.reconnectDelayMs, 0, "connection.reconnectDelayMs");
  requireInteger(config.connection.reconnectMaxDelayMs, 1, "connection.reconnectMaxDelayMs");
  requireInteger(config.connection.publishConfirmTimeoutMs, 1, "connection.publishConfirmTimeoutMs");
  requireInteger(config.consume.prefetch, 0, "consume.prefetch");
  requireInteger(config.consume.concurrency, 1, "consume.concurrency");
  requireInteger(config.dispatch.timeoutMs, 1, "dispatch.timeoutMs");
  requireInteger(config.idempotency.ttlMs, 1, "idempotency.ttlMs");
  requireInteger(config.idempotency.maxEntries, 1, "idempotency.maxEntries");
  if (!Number.isFinite(config.connection.reconnectJitterRatio) ||
      config.connection.reconnectJitterRatio < 0 || config.connection.reconnectJitterRatio > 1) {
    issues.push("connection.reconnectJitterRatio must be between 0 and 1");
  }
  if (config.connection.reconnectMaxDelayMs < config.connection.reconnectDelayMs) {
    issues.push("connection.reconnectMaxDelayMs must be >= connection.reconnectDelayMs");
  }
  if (config.retry.queueSuffix === config.retry.deadLetterSuffix) {
    issues.push("retry.queueSuffix and retry.deadLetterSuffix must be different");
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
 * @description 构建可序列化的 RabbitMQ 配置快照（供 HTTP `/rabbitmq/status` 响应）。
 * @param config - 当前生效的配置对象
 * @returns 浅拷贝的配置键值对象
 */
export function buildRabbitmqConfigSnapshot(config: RabbitmqConfig): Record<string, unknown> {
  return {
    url: redactRabbitmqUrl(config.url),
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

function redactRabbitmqUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!url.username && !url.password) return value;
    if (url.username) url.username = "***";
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return "<invalid-rabbitmq-url>";
  }
}
