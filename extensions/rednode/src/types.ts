/** 由管理员从小红书 Ark 官方文档复制并加入白名单的单个操作。 */
export type RednodeOperation = {
  name: string;
  description?: string;
  method: "GET" | "POST" | "PUT";
  apiPath: string;
};

/** 经过运行时严格校验、可直接交给 Ark 客户端使用的插件配置。 */
export type RednodePluginConfig = {
  enabled: true;
  appKey: string;
  appSecret: string;
  environment: "production" | "sandbox";
  apiBaseUrl: string;
  operations: RednodeOperation[];
  requestTimeoutMs: number;
  maxRequestBytes: number;
  maxResponseBytes: number;
  /** 进入 Agent transcript 的独立结果上限，通常应小于上游响应上限。 */
  maxToolResultBytes: number;
  maxRequestsPerMinute: number;
  /** 同时占用 Ark HTTP 连接的调用上限，避免突发请求耗尽连接池。 */
  maxConcurrentRequests: number;
  getRetryMaxAttempts: number;
  retryInitialDelayMs: number;
  retryMaxDelayMs: number;
  retryJitterRatio: number;
  allowCustomApiBaseUrl: boolean;
  ownerOnly: boolean;
};

/** 不包含 operation 参数、响应正文或凭据的客户端运维快照。 */
export type RednodeClientStatus = {
  activeRequests: number;
  maxConcurrentRequests: number;
  requestsInCurrentWindow: number;
  maxRequestsPerMinute: number;
  attemptsTotal: number;
  successfulInvocationsTotal: number;
  failedInvocationsTotal: number;
  concurrencyRejectedTotal: number;
  rateLimitRejectedTotal: number;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
};

/** Ark 标准 JSON 响应；具体 data 结构由白名单 operation 对应的官方接口决定。 */
export type RednodeApiResponse = Record<string, unknown>;
