export const DEFAULT_ACCOUNT_ID = "default";
export const CHANNEL_ID = "TEMPLATE_NAME";

export interface TemplateConfig {
  enabled?: boolean;
  name?: string;
  accounts?: Record<string, { enabled?: boolean }>;
}

export interface ResolvedAccount {
  accountId: string;
  name?: string;
  enabled: boolean;
  configured: boolean;
}
