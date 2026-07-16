export type AmapPluginConfig = {
  enabled: boolean;
  key: string;
  apiBaseUrl: string;
  requestTimeoutMs: number;
  retryAttempts: number;
  maxResponseBytes: number;
  maxRequestsPerMinute: number;
  ownerOnly: boolean;
};

export type AmapApiResponse = Record<string, unknown>;
