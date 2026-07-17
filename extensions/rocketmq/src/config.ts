/**
 * @fileoverview RocketMQ 插件配置形状、默认值与解析/校验。
 *
 * @description
 * `RockermqConfig` 与宿主 `openclaw.plugin.json` 中 `channels.rocketmq` 段对齐；
 * `resolveRockermqConfig` 从网关全局配置合并默认值，`validateRockermqConfig` 做启动前校验，
 * `buildRockermqConfigSnapshot` 供诊断接口脱敏输出。
 *
 * @module config
 */

/**
 * RocketMQ 配置 — Base Profile 入口。
 */

/** @description Agent 入站消息分发模式。 */
export type DispatchMode = "reply-pipeline" | "embedded-agent" | "subagent";

/** @description 入站 wire payload 解析策略。 */
export type PayloadMode = "jsonTextOrPlain" | "jsonOnly" | "plainText";

/** @description Topic + Tag 与 Agent/Account 的显式绑定项。 */
export type TopicBinding = {
  topic: string;
  tag: string;
  agentId: string;
  accountId: string;
  peerId?: string;
  replyTopic?: string;
  replyTag?: string;
};

/** @description RocketMQ 渠道完整运行时配置（Producer / Consumer / 路由 / 幂等）。 */
export type RockermqConfig = {
  endpoints: string;
  namespace: string;
  topicPrefix: string;
  sessionCredentials?: {
    accessKey: string;
    accessSecret: string;
    securityToken?: string;
  };
  producer: {
    groupId: string;
    requestTimeout: number;
    maxAttempts: number;
    /** 单条出站消息上限；默认遵循 RocketMQ 常见的 4 MiB 限制。 */
    maxMessageSizeInBytes: number;
  };
  consumer: {
    groupId: string;
    subscriptions: Array<{
      topic: string;
      filterExpression: string;
    }>;
    maxCacheMessageCount: number;
    maxCacheMessageSizeInBytes: number;
    longPollingTimeout: number;
    requestTimeout: number;
    reconsumeOnError: boolean;
    retry: {
      maxAttempts: number;
      initialDelayMs: number;
      maxDelayMs: number;
      multiplier: number;
    };
  };
  topicBindings: TopicBinding[];
  payload: {
    mode: PayloadMode;
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
  connection: {
    startupAttempts: number;
    /** 第一次启动重试的基础延迟。 */
    retryDelayMs: number;
    /** 指数退避的延迟上限，避免 Broker 长时间故障时形成高频重连风暴。 */
    retryMaxDelayMs: number;
    /** 退避抖动比例（0～1），用于打散多个 Gateway 实例的同步重连。 */
    retryJitterRatio: number;
    /** Producer/Consumer 优雅退出预算；超时后停止等待，保证 Gateway 可退出。 */
    shutdownTimeoutMs: number;
  };
};

/**
 * @description 默认 RocketMQ 配置（本地开发 / 缺省合并基准）。
 * @returns 不可变默认配置对象引用。
 */
export const DEFAULT_ROCKERMQ_CONFIG: RockermqConfig = {
  endpoints: "127.0.0.1:8081",
  namespace: "",
  topicPrefix: "openclaw",
  sessionCredentials: undefined,
  producer: {
    groupId: "openclaw-rocketmq-producer",
    requestTimeout: 5000,
    maxAttempts: 3,
    maxMessageSizeInBytes: 4 * 1024 * 1024,
  },
  consumer: {
    groupId: "openclaw-rocketmq-consumer",
    subscriptions: [],
    maxCacheMessageCount: 1024,
    maxCacheMessageSizeInBytes: 64 * 1024 * 1024,
    longPollingTimeout: 30000,
    requestTimeout: 3000,
    reconsumeOnError: true,
    retry: {
      maxAttempts: 17,
      initialDelayMs: 1000,
      maxDelayMs: 60_000,
      multiplier: 2,
    },
  },
  topicBindings: [],
  payload: {
    mode: "jsonTextOrPlain",
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
  connection: {
    startupAttempts: 6,
    retryDelayMs: 5000,
    retryMaxDelayMs: 60_000,
    retryJitterRatio: 0.2,
    shutdownTimeoutMs: 10_000,
  },
};

/**
 * @description 从网关全局配置解析 `channels.rocketmq`（或顶层 `rocketmq`）并合并默认值。
 * @param cfg - 宿主 runtime.config 或等价配置对象。
 * @returns 合并后的 `RockermqConfig`。
 * @throws 不抛出；缺省字段使用默认值，显式非法值会保留为可被校验器识别的值。
 */
export function resolveRockermqConfig(
  cfg: Record<string, unknown> | undefined | null,
): RockermqConfig {
  const channels = (cfg?.channels as Record<string, unknown> | undefined) ?? {};
  const rocketmq =
    (channels.rocketmq as Record<string, unknown> | null | undefined) ??
    (cfg?.rocketmq as Record<string, unknown> | null | undefined) ??
    {};
  const producer =
    (rocketmq.producer as Record<string, unknown> | undefined) ?? {};
  const consumer =
    (rocketmq.consumer as Record<string, unknown> | undefined) ?? {};
  const consumerRetry =
    (consumer.retry as Record<string, unknown> | undefined) ?? {};
  const payload =
    (rocketmq.payload as Record<string, unknown> | undefined) ?? {};
  const dispatch =
    (rocketmq.dispatch as Record<string, unknown> | undefined) ?? {};
  const dispatchReply =
    (dispatch.reply as Record<string, unknown> | undefined) ?? {};
  const idempotency =
    (rocketmq.idempotency as Record<string, unknown> | undefined) ?? {};
  const connection =
    (rocketmq.connection as Record<string, unknown> | undefined) ?? {};
  const sessionCredentials =
    (rocketmq.sessionCredentials as Record<string, unknown> | undefined) ?? {};

  return {
    endpoints: String(rocketmq.endpoints ?? DEFAULT_ROCKERMQ_CONFIG.endpoints),
    namespace: String(rocketmq.namespace ?? DEFAULT_ROCKERMQ_CONFIG.namespace),
    topicPrefix: String(
      rocketmq.topicPrefix ?? DEFAULT_ROCKERMQ_CONFIG.topicPrefix,
    ),
    // 只对“未配置”应用默认值；若用户只写了一半凭证，则保留空字段让启动校验明确报错，
    // 不能悄悄退化成匿名连接，否则在开发环境可用、生产 ACL 环境却会表现为反复重连。
    sessionCredentials:
      Object.keys(sessionCredentials).length > 0
        ? {
            accessKey:
              typeof sessionCredentials.accessKey === "string"
                ? sessionCredentials.accessKey
                : "",
            accessSecret:
              typeof sessionCredentials.accessSecret === "string"
                ? sessionCredentials.accessSecret
                : "",
            securityToken:
              typeof sessionCredentials.securityToken === "string"
                ? sessionCredentials.securityToken
                : undefined,
          }
        : undefined,
    producer: {
      groupId: String(
        producer.groupId ?? DEFAULT_ROCKERMQ_CONFIG.producer.groupId,
      ),
      requestTimeout: resolveExplicitNumber(
        producer.requestTimeout,
        DEFAULT_ROCKERMQ_CONFIG.producer.requestTimeout,
      ),
      maxAttempts: resolveExplicitNumber(
        producer.maxAttempts,
        DEFAULT_ROCKERMQ_CONFIG.producer.maxAttempts,
      ),
      maxMessageSizeInBytes: resolveExplicitNumber(
        producer.maxMessageSizeInBytes,
        DEFAULT_ROCKERMQ_CONFIG.producer.maxMessageSizeInBytes,
      ),
    },
    consumer: {
      groupId: String(
        consumer.groupId ?? DEFAULT_ROCKERMQ_CONFIG.consumer.groupId,
      ),
      subscriptions: Array.isArray(consumer.subscriptions)
        ? consumer.subscriptions.map((item) => {
            const value = item as Record<string, unknown>;
            return {
              topic: String(value.topic ?? ""),
              filterExpression: String(value.filterExpression ?? "*"),
            };
          })
        : DEFAULT_ROCKERMQ_CONFIG.consumer.subscriptions,
      maxCacheMessageCount: resolveExplicitNumber(
        consumer.maxCacheMessageCount,
        DEFAULT_ROCKERMQ_CONFIG.consumer.maxCacheMessageCount,
      ),
      maxCacheMessageSizeInBytes: resolveExplicitNumber(
        consumer.maxCacheMessageSizeInBytes,
        DEFAULT_ROCKERMQ_CONFIG.consumer.maxCacheMessageSizeInBytes,
      ),
      longPollingTimeout: resolveExplicitNumber(
        consumer.longPollingTimeout,
        DEFAULT_ROCKERMQ_CONFIG.consumer.longPollingTimeout,
      ),
      requestTimeout: resolveExplicitNumber(
        consumer.requestTimeout,
        DEFAULT_ROCKERMQ_CONFIG.consumer.requestTimeout,
      ),
      reconsumeOnError: consumer.reconsumeOnError !== false,
      retry: {
        maxAttempts: resolveExplicitNumber(
          consumerRetry.maxAttempts,
          DEFAULT_ROCKERMQ_CONFIG.consumer.retry.maxAttempts,
        ),
        initialDelayMs: resolveExplicitNumber(
          consumerRetry.initialDelayMs,
          DEFAULT_ROCKERMQ_CONFIG.consumer.retry.initialDelayMs,
        ),
        maxDelayMs: resolveExplicitNumber(
          consumerRetry.maxDelayMs,
          DEFAULT_ROCKERMQ_CONFIG.consumer.retry.maxDelayMs,
        ),
        multiplier: resolveExplicitNumber(
          consumerRetry.multiplier,
          DEFAULT_ROCKERMQ_CONFIG.consumer.retry.multiplier,
        ),
      },
    },
    topicBindings: Array.isArray(rocketmq.topicBindings)
      ? rocketmq.topicBindings.map((item) => {
          const value = item as Record<string, unknown>;
          return {
            topic: String(value.topic ?? ""),
            tag: String(value.tag ?? "*"),
            agentId: String(value.agentId ?? ""),
            peerId: typeof value.peerId === "string" ? value.peerId : undefined,
            accountId: String(value.accountId ?? "default"),
            replyTopic:
              typeof value.replyTopic === "string"
                ? value.replyTopic
                : undefined,
            replyTag:
              typeof value.replyTag === "string" ? value.replyTag : undefined,
          };
        })
      : DEFAULT_ROCKERMQ_CONFIG.topicBindings,
    payload: {
      mode:
        payload.mode === "jsonOnly" ||
        payload.mode === "plainText" ||
        payload.mode === "jsonTextOrPlain"
          ? payload.mode
          : payload.mode === undefined
            ? DEFAULT_ROCKERMQ_CONFIG.payload.mode
            : (String(payload.mode) as PayloadMode),
    },
    dispatch: {
      mode:
        dispatch.mode === "reply-pipeline" ||
        dispatch.mode === "subagent" ||
        dispatch.mode === "embedded-agent"
          ? dispatch.mode
          : dispatch.mode === undefined
            ? DEFAULT_ROCKERMQ_CONFIG.dispatch.mode
            : (String(dispatch.mode) as DispatchMode),
      timeoutMs: resolveExplicitNumber(
        dispatch.timeoutMs,
        DEFAULT_ROCKERMQ_CONFIG.dispatch.timeoutMs,
      ),
      reply: {
        enabled: dispatchReply.enabled !== false,
      },
    },
    idempotency: {
      enabled: idempotency.enabled !== false,
      ttlMs: resolveExplicitNumber(
        idempotency.ttlMs,
        DEFAULT_ROCKERMQ_CONFIG.idempotency.ttlMs,
      ),
      maxEntries: resolveExplicitNumber(
        idempotency.maxEntries,
        DEFAULT_ROCKERMQ_CONFIG.idempotency.maxEntries,
      ),
    },
    connection: {
      startupAttempts: resolveExplicitNumber(
        connection.startupAttempts,
        DEFAULT_ROCKERMQ_CONFIG.connection.startupAttempts,
      ),
      retryDelayMs: resolveExplicitNumber(
        connection.retryDelayMs,
        DEFAULT_ROCKERMQ_CONFIG.connection.retryDelayMs,
      ),
      retryMaxDelayMs: resolveExplicitNumber(
        connection.retryMaxDelayMs,
        DEFAULT_ROCKERMQ_CONFIG.connection.retryMaxDelayMs,
      ),
      retryJitterRatio: resolveExplicitNumber(
        connection.retryJitterRatio,
        DEFAULT_ROCKERMQ_CONFIG.connection.retryJitterRatio,
      ),
      shutdownTimeoutMs: resolveExplicitNumber(
        connection.shutdownTimeoutMs,
        DEFAULT_ROCKERMQ_CONFIG.connection.shutdownTimeoutMs,
      ),
    },
  };
}

/**
 * @description 校验 RocketMQ 必填项与重试参数（endpoints、consumer groupId 等）。
 * @param config - 已解析配置。
 * @returns 人类可读问题描述列表；空数组表示通过。
 * @throws 不抛出。
 */
export function validateRockermqConfig(config: RockermqConfig): string[] {
  const issues: string[] = [];
  const validResourceName = /^[a-zA-Z0-9_-]+$/;
  if (!config.endpoints) {
    issues.push("RocketMQ endpoints is required");
  } else if (/\s|[\u0000-\u001f\u007f]/.test(config.endpoints)) {
    issues.push(
      "RocketMQ endpoints must not contain whitespace or control characters",
    );
  }
  if (
    config.sessionCredentials &&
    (!config.sessionCredentials.accessKey ||
      !config.sessionCredentials.accessSecret)
  ) {
    issues.push(
      "RocketMQ sessionCredentials requires both accessKey and accessSecret",
    );
  }
  validatePositiveNumber(
    issues,
    "producer.requestTimeout",
    config.producer.requestTimeout,
  );
  validatePositiveInteger(
    issues,
    "producer.maxAttempts",
    config.producer.maxAttempts,
  );
  validatePositiveInteger(
    issues,
    "producer.maxMessageSizeInBytes",
    config.producer.maxMessageSizeInBytes,
  );
  if (!config.consumer.groupId) {
    issues.push("RocketMQ consumer.groupId is required");
  } else if (!validResourceName.test(config.consumer.groupId)) {
    issues.push("RocketMQ consumer.groupId must use [a-zA-Z0-9_-]");
  }
  if (
    !validResourceName.test(config.topicPrefix) ||
    config.topicPrefix.includes("--")
  ) {
    issues.push(
      "RocketMQ topicPrefix must use [a-zA-Z0-9_-] and must not contain '--'",
    );
  }
  const subscriptionTopics = new Set<string>();
  for (const subscription of config.consumer.subscriptions) {
    if (!validResourceName.test(subscription.topic)) {
      issues.push(
        `RocketMQ consumer subscription topic is invalid: ${subscription.topic}`,
      );
    }
    if (subscriptionTopics.has(subscription.topic)) {
      issues.push(
        `RocketMQ consumer subscription topic is duplicated: ${subscription.topic}`,
      );
    }
    subscriptionTopics.add(subscription.topic);
  }
  const bindingKeys = new Set<string>();
  for (const binding of config.topicBindings) {
    if (!validResourceName.test(binding.topic)) {
      issues.push(`RocketMQ topic binding is invalid: ${binding.topic}`);
    }
    if (!binding.agentId.trim()) {
      issues.push(
        `RocketMQ topic binding agentId is required for topic: ${binding.topic}`,
      );
    }
    if (!binding.accountId.trim()) {
      issues.push(
        `RocketMQ topic binding accountId is required for topic: ${binding.topic}`,
      );
    }
    const bindingKey = `${binding.topic}\u0000${binding.tag}`;
    if (bindingKeys.has(bindingKey)) {
      issues.push(
        `RocketMQ topic binding is duplicated: ${binding.topic}#${binding.tag}`,
      );
    }
    bindingKeys.add(bindingKey);
    if (binding.replyTopic && !validResourceName.test(binding.replyTopic)) {
      issues.push(`RocketMQ reply topic is invalid: ${binding.replyTopic}`);
    }
  }
  validatePositiveInteger(
    issues,
    "consumer.maxCacheMessageCount",
    config.consumer.maxCacheMessageCount,
  );
  validatePositiveInteger(
    issues,
    "consumer.maxCacheMessageSizeInBytes",
    config.consumer.maxCacheMessageSizeInBytes,
  );
  validatePositiveNumber(
    issues,
    "consumer.longPollingTimeout",
    config.consumer.longPollingTimeout,
  );
  validatePositiveNumber(
    issues,
    "consumer.requestTimeout",
    config.consumer.requestTimeout,
  );
  validatePositiveInteger(
    issues,
    "consumer.retry.maxAttempts",
    config.consumer.retry.maxAttempts,
  );
  validatePositiveNumber(
    issues,
    "consumer.retry.initialDelayMs",
    config.consumer.retry.initialDelayMs,
  );
  validatePositiveNumber(
    issues,
    "consumer.retry.maxDelayMs",
    config.consumer.retry.maxDelayMs,
  );
  if (config.consumer.retry.maxDelayMs < config.consumer.retry.initialDelayMs) {
    issues.push("RocketMQ consumer.retry.maxDelayMs must be >= initialDelayMs");
  }
  if (
    !Number.isFinite(config.consumer.retry.multiplier) ||
    config.consumer.retry.multiplier < 1
  ) {
    issues.push(
      "RocketMQ consumer.retry.multiplier must be a finite number >= 1",
    );
  }
  if (
    !(["jsonTextOrPlain", "jsonOnly", "plainText"] as string[]).includes(
      config.payload.mode,
    )
  ) {
    issues.push(
      `RocketMQ payload.mode is invalid: ${String(config.payload.mode)}`,
    );
  }
  if (
    !(["reply-pipeline", "embedded-agent", "subagent"] as string[]).includes(
      config.dispatch.mode,
    )
  ) {
    issues.push(
      `RocketMQ dispatch.mode is invalid: ${String(config.dispatch.mode)}`,
    );
  }
  validatePositiveNumber(
    issues,
    "dispatch.timeoutMs",
    config.dispatch.timeoutMs,
  );
  validatePositiveNumber(issues, "idempotency.ttlMs", config.idempotency.ttlMs);
  validatePositiveInteger(
    issues,
    "idempotency.maxEntries",
    config.idempotency.maxEntries,
  );
  validatePositiveInteger(
    issues,
    "connection.startupAttempts",
    config.connection.startupAttempts,
  );
  validateNonNegativeNumber(
    issues,
    "connection.retryDelayMs",
    config.connection.retryDelayMs,
  );
  validatePositiveNumber(
    issues,
    "connection.retryMaxDelayMs",
    config.connection.retryMaxDelayMs,
  );
  if (config.connection.retryMaxDelayMs < config.connection.retryDelayMs) {
    issues.push("RocketMQ connection.retryMaxDelayMs must be >= retryDelayMs");
  }
  if (
    !Number.isFinite(config.connection.retryJitterRatio) ||
    config.connection.retryJitterRatio < 0 ||
    config.connection.retryJitterRatio > 1
  ) {
    issues.push("RocketMQ connection.retryJitterRatio must be between 0 and 1");
  }
  validatePositiveNumber(
    issues,
    "connection.shutdownTimeoutMs",
    config.connection.shutdownTimeoutMs,
  );
  return issues;
}

/**
 * 只给缺省字段补默认值；显式类型错误转为 `NaN`，交由统一校验生成可定位的错误信息。
 */
function resolveExplicitNumber(value: unknown, fallback: number): number {
  return value === undefined
    ? fallback
    : typeof value === "number"
      ? value
      : Number.NaN;
}

/** 正数校验用于毫秒等允许小数、但必须大于零的配置。 */
function validatePositiveNumber(
  issues: string[],
  path: string,
  value: number,
): void {
  if (!Number.isFinite(value) || value <= 0) {
    issues.push(`RocketMQ ${path} must be a positive finite number`);
  }
}

/** 正整数校验用于次数、条数和字节上限。 */
function validatePositiveInteger(
  issues: string[],
  path: string,
  value: number,
): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    issues.push(`RocketMQ ${path} must be a positive safe integer`);
  }
}

/** 非负数校验用于允许关闭延迟的连接重试参数。 */
function validateNonNegativeNumber(
  issues: string[],
  path: string,
  value: number,
): void {
  if (!Number.isFinite(value) || value < 0) {
    issues.push(`RocketMQ ${path} must be a non-negative finite number`);
  }
}

/**
 * @description 构建脱敏后的配置快照（隐藏 accessSecret / securityToken）。
 * @param config - 已解析配置。
 * @returns 可 JSON 序列化的配置对象。
 * @throws 不抛出。
 */
export function buildRockermqConfigSnapshot(
  config: RockermqConfig,
): Record<string, unknown> {
  return {
    ...config,
    sessionCredentials: config.sessionCredentials
      ? {
          ...config.sessionCredentials,
          accessKey: "***",
          accessSecret: "***",
          securityToken: config.sessionCredentials.securityToken
            ? "***"
            : undefined,
        }
      : undefined,
  };
}
