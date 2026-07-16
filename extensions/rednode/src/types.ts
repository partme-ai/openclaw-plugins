export type RednodeOperation = {
  name: string;
  description?: string;
  method: "GET" | "POST" | "PUT";
  apiPath: string;
};

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
  maxRequestsPerMinute: number;
  ownerOnly: boolean;
};

export type RednodeApiResponse = Record<string, unknown>;
