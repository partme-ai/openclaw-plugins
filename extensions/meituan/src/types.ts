export type MeituanOperation = {
  name: string;
  description?: string;
  apiPath: string;
  businessId: number;
  requiresAuth: boolean;
};

export type MeituanPluginConfig = {
  enabled: true;
  developerId: string;
  signKey: string;
  appAuthToken?: string;
  apiBaseUrl: string;
  version: string;
  operations: MeituanOperation[];
  requestTimeoutMs: number;
  maxRequestBytes: number;
  maxResponseBytes: number;
  maxRequestsPerMinute: number;
  ownerOnly: boolean;
};

export type MeituanApiResponse = Record<string, unknown>;
