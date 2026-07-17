/** 高德 capability 的已解析配置；密钥只在传输层使用，不应进入 Tool 返回值或日志。 */
export type AmapPluginConfig = {
  enabled: boolean;
  key: string;
  apiBaseUrl: string;
  requestTimeoutMs: number;
  retryAttempts: number;
  maxResponseBytes: number;
  maxToolResultBytes: number;
  maxRequestsPerMinute: number;
  ownerOnly: boolean;
};

/** 官方接口字段随具体地点 API 变化，由工具层按操作继续收窄。 */
export type AmapApiResponse = Record<string, unknown>;
