/**
 * RocketMQ 配置定义与解析。
 */

export type DispatchMode = "reply-pipeline" | "embedded-agent" | "subagent";
export type PayloadMode = "jsonTextOrPlain" | "jsonOnly" | "plainText";

export type TopicBinding = {
  topic: string;
  tag: string;
  agentId: string;
  accountId: string;
  peerId?: string;
  replyTopic?: string;
  replyTag?: string;
};

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
};

/**
 * 默认 RocketMQ 配置。
 */
export const DEFAULT_ROCKERMQ_CONFIG: RockermqConfig = {
  endpoints: "127.0.0.1:8081",
  namespace: "",
  topicPrefix: "openclaw",
  sessionCredentials: undefined,
  producer: {
    groupId: "openclaw-rockermq-producer",
    requestTimeout: 5000,
  },
  consumer: {
    groupId: "openclaw-rockermq-consumer",
    subscriptions: [],
    maxCacheMessageCount: 1024,
    maxCacheMessageSizeInBytes: 64 * 1024 * 1024,
    longPollingTimeout: 30000,
    requestTimeout: 3000,
    reconsumeOnError: true,
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
    enabled: false,
    ttlMs: 10 * 60_000,
    maxEntries: 10_000,
  },
};

/**
 * 解析运行时配置中的 RocketMQ 段。
 */
export function resolveRockermqConfig(
  cfg: Record<string, unknown> | undefined | null,
): RockermqConfig {
  const channels = (cfg?.channels as Record<string, unknown> | undefined) ?? {};
  const rockermq =
    (channels.rockermq as Record<string, unknown> | null | undefined) ??
    (cfg?.rockermq as Record<string, unknown> | null | undefined) ??
    {};
  const producer = (rockermq.producer as Record<string, unknown> | undefined) ?? {};
  const consumer = (rockermq.consumer as Record<string, unknown> | undefined) ?? {};
  const payload = (rockermq.payload as Record<string, unknown> | undefined) ?? {};
  const dispatch = (rockermq.dispatch as Record<string, unknown> | undefined) ?? {};
  const dispatchReply = (dispatch.reply as Record<string, unknown> | undefined) ?? {};
  const idempotency = (rockermq.idempotency as Record<string, unknown> | undefined) ?? {};
  const sessionCredentials =
    (rockermq.sessionCredentials as Record<string, unknown> | undefined) ?? {};

  return {
    endpoints: String(rockermq.endpoints ?? DEFAULT_ROCKERMQ_CONFIG.endpoints),
    namespace: String(rockermq.namespace ?? DEFAULT_ROCKERMQ_CONFIG.namespace),
    topicPrefix: String(rockermq.topicPrefix ?? DEFAULT_ROCKERMQ_CONFIG.topicPrefix),
    sessionCredentials:
      typeof sessionCredentials.accessKey === "string" &&
      typeof sessionCredentials.accessSecret === "string"
        ? {
            accessKey: sessionCredentials.accessKey,
            accessSecret: sessionCredentials.accessSecret,
            securityToken:
              typeof sessionCredentials.securityToken === "string"
                ? sessionCredentials.securityToken
                : undefined,
          }
        : undefined,
    producer: {
      groupId: String(producer.groupId ?? DEFAULT_ROCKERMQ_CONFIG.producer.groupId),
      requestTimeout:
        typeof producer.requestTimeout === "number" && producer.requestTimeout > 0
          ? producer.requestTimeout
          : DEFAULT_ROCKERMQ_CONFIG.producer.requestTimeout,
    },
    consumer: {
      groupId: String(consumer.groupId ?? DEFAULT_ROCKERMQ_CONFIG.consumer.groupId),
      subscriptions: Array.isArray(consumer.subscriptions)
        ? consumer.subscriptions
            .map((item) => {
              const value = item as Record<string, unknown>;
              return {
                topic: String(value.topic ?? ""),
                filterExpression: String(value.filterExpression ?? "*"),
              };
            })
            .filter((item) => item.topic.length > 0)
        : DEFAULT_ROCKERMQ_CONFIG.consumer.subscriptions,
      maxCacheMessageCount:
        typeof consumer.maxCacheMessageCount === "number" && consumer.maxCacheMessageCount > 0
          ? consumer.maxCacheMessageCount
          : DEFAULT_ROCKERMQ_CONFIG.consumer.maxCacheMessageCount,
      maxCacheMessageSizeInBytes:
        typeof consumer.maxCacheMessageSizeInBytes === "number" &&
        consumer.maxCacheMessageSizeInBytes > 0
          ? consumer.maxCacheMessageSizeInBytes
          : DEFAULT_ROCKERMQ_CONFIG.consumer.maxCacheMessageSizeInBytes,
      longPollingTimeout:
        typeof consumer.longPollingTimeout === "number" && consumer.longPollingTimeout > 0
          ? consumer.longPollingTimeout
          : DEFAULT_ROCKERMQ_CONFIG.consumer.longPollingTimeout,
      requestTimeout:
        typeof consumer.requestTimeout === "number" && consumer.requestTimeout > 0
          ? consumer.requestTimeout
          : DEFAULT_ROCKERMQ_CONFIG.consumer.requestTimeout,
      reconsumeOnError: consumer.reconsumeOnError !== false,
    },
    topicBindings: Array.isArray(rockermq.topicBindings)
      ? rockermq.topicBindings
          .map((item) => {
            const value = item as Record<string, unknown>;
            return {
              topic: String(value.topic ?? ""),
              tag: String(value.tag ?? "*"),
              agentId: String(value.agentId ?? ""),
              peerId: typeof value.peerId === "string" ? value.peerId : undefined,
              accountId: String(value.accountId ?? "default"),
              replyTopic: typeof value.replyTopic === "string" ? value.replyTopic : undefined,
              replyTag: typeof value.replyTag === "string" ? value.replyTag : undefined,
            };
          })
          .filter((item) => item.topic.length > 0 && item.agentId.length > 0)
      : DEFAULT_ROCKERMQ_CONFIG.topicBindings,
    payload: {
      mode:
        payload.mode === "jsonOnly" ||
        payload.mode === "plainText" ||
        payload.mode === "jsonTextOrPlain"
          ? payload.mode
          : DEFAULT_ROCKERMQ_CONFIG.payload.mode,
    },
    dispatch: {
      mode:
        dispatch.mode === "reply-pipeline" ||
        dispatch.mode === "subagent" ||
        dispatch.mode === "embedded-agent"
          ? dispatch.mode
          : DEFAULT_ROCKERMQ_CONFIG.dispatch.mode,
      timeoutMs:
        typeof dispatch.timeoutMs === "number" && dispatch.timeoutMs > 0
          ? dispatch.timeoutMs
          : DEFAULT_ROCKERMQ_CONFIG.dispatch.timeoutMs,
      reply: {
        enabled: dispatchReply.enabled !== false,
      },
    },
    idempotency: {
      enabled: idempotency.enabled === true,
      ttlMs:
        typeof idempotency.ttlMs === "number" && idempotency.ttlMs > 0
          ? idempotency.ttlMs
          : DEFAULT_ROCKERMQ_CONFIG.idempotency.ttlMs,
      maxEntries:
        typeof idempotency.maxEntries === "number" && idempotency.maxEntries > 0
          ? idempotency.maxEntries
          : DEFAULT_ROCKERMQ_CONFIG.idempotency.maxEntries,
    },
  };
}

/**
 * 校验 RocketMQ 配置。
 */
export function validateRockermqConfig(config: RockermqConfig): string[] {
  const issues: string[] = [];
  if (!config.endpoints) {
    issues.push("RocketMQ endpoints is required");
  }
  if (!config.producer.groupId) {
    issues.push("RocketMQ producer.groupId is required");
  }
  if (!config.consumer.groupId) {
    issues.push("RocketMQ consumer.groupId is required");
  }
  return issues;
}

/**
 * 构建脱敏后的配置快照。
 */
export function buildRockermqConfigSnapshot(config: RockermqConfig): Record<string, unknown> {
  return {
    ...config,
    sessionCredentials: config.sessionCredentials
      ? {
          ...config.sessionCredentials,
          accessSecret: "***",
          securityToken: config.sessionCredentials.securityToken ? "***" : undefined,
        }
      : undefined,
  };
}
