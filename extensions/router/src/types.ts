export type RouteDirection = "inbound" | "outbound";

export type RouteAction =
  | { type: "forward"; target: string; topic?: string }
  | { type: "reply-via"; target: string; accountId?: string; to?: string };

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

export type PublishInboundParams = {
  channel: string;
  content: string;
  topic?: string;
  accountId?: string;
  to?: string;
  metadata?: Record<string, unknown>;
};

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
