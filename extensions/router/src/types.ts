/**
 * Router 的持久投递配置模型。
 *
 * `actions` 描述业务意图；`delivery` 描述 Outbox、幂等、退避、DLQ、跨进程写锁
 * 和资源上限。两者分离后，规则调整不会绕过可靠投递边界。
 */
export type RouteDirection = "inbound" | "outbound";

/**
 * 规则命中后的投递动作。
 *
 * `forward` 面向 Topic/队列式渠道，`reply-via` 面向具有账号和收件人的 IM 渠道；两者最终都
 * 转换为同一种持久投递任务，不允许绕过 Outbox 直接发送。
 */
export type RouteAction =
  | { type: "forward"; target: string; topic?: string }
  | { type: "reply-via"; target: string; accountId?: string; to?: string };

/** 一条有稳定 ID 的路由规则；所有 match 条件为 AND，actions 则按 fan-out 全部入队。 */
export interface RouterRule {
  id: string;
  match: {
    channels?: string[];
    direction?: RouteDirection | "both";
    topic?: string;
    accountId?: string;
  };
  actions: RouteAction[];
}

/**
 * Router 完整运行时配置，包含业务规则、审计和持久投递安全边界。
 *
 * 所有容量、重试、超时、hop 与单写者 lease 参数均由配置解析器校验后才可使用。
 */
export interface RouterConfig {
  enabled: boolean;
  rules: RouterRule[];
  audit: {
    enabled: boolean;
    logToConsole: boolean;
    maxEntries: number;
  };
  delivery: {
    stateDir?: string;
    maxAttempts: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
    jitter: number;
    dedupeTtlMs: number;
    maxDeliveredKeys: number;
    maxDeadLetters: number;
    maxPendingTasks: number;
    maxPayloadBytes: number;
    maxHops: number;
    publishTimeoutMs: number;
    concurrency: number;
    lockHeartbeatMs: number;
    lockTimeoutMs: number;
  };
}

/** Router 交给目标 Channel outbound adapter 的统一消息载荷。 */
export type PublishInboundParams = {
  channel: string;
  content: string;
  topic?: string;
  accountId?: string;
  to?: string;
  metadata?: Record<string, unknown>;
};

/**
 * 持久 Outbox 中的单个投递任务。
 *
 * `id` 标识任务，`dedupeKey` 跨重启抑制重复业务投递；attempts/nextAttemptAt 驱动退避和 DLQ。
 */
export type RouteDeliveryTask = {
  id: string;
  dedupeKey: string;
  ruleId: string;
  actionType: RouteAction["type"];
  payload: PublishInboundParams;
  attempts: number;
  createdAt: number;
  nextAttemptAt: number;
  lastError?: string;
};
