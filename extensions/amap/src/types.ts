/** 高德 capability 的已解析配置；密钥只在传输层使用，不应进入 Tool 返回值或日志。 */
export type AmapPluginConfig = {
  enabled: boolean;
  key: string;
  /** 高德控制台为该 Key 开启数字签名后对应的私钥；只参与本地 MD5，不发送给高德。 */
  privateKey?: string;
  apiBaseUrl: string;
  requestTimeoutMs: number;
  retryAttempts: number;
  maxResponseBytes: number;
  maxToolResultBytes: number;
  maxRequestsPerMinute: number;
  maxConcurrentRequests: number;
  ownerOnly: boolean;
};

/** 官方接口字段随具体地点 API 变化，由工具层按操作继续收窄。 */
export type AmapApiResponse = Record<string, unknown>;

/** 同一进程内 AMap 客户端的低敏运行状态，不包含查询词、坐标、响应正文或凭据。 */
export type AmapClientStatus = {
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
