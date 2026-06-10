/** 默认账号 ID。 */
export const DEFAULT_ACCOUNT_ID = "default";

/** 通道 ID（与 openclaw.plugin.json#id 一致）。 */
export const CHANNEL_ID = "TEMPLATE_NAME";

/** 插件配置根结构（channels.TEMPLATE_NAME）。 */
export interface TemplateConfig {
  enabled?: boolean;
  name?: string;
  accounts?: Record<string, { enabled?: boolean }>;
}

/** 解析后的账号视图。 */
export interface ResolvedAccount {
  accountId: string;
  name?: string;
  enabled: boolean;
  configured: boolean;
}
