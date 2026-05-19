/**
 * 抖音渠道配置与解析结果类型。
 */

/** openclaw.json → channels.douyin 原始结构 */
export type DouyinChannelConfig = {
  enabled?: boolean;
  /** 对应开放平台 client_key */
  app_key?: string;
  /** 对应开放平台 client_secret */
  app_secret?: string;
  shop_id?: string;
  /** Gateway 上注册的 Webhook 路径，默认 /channels/douyin/webhook */
  webhook_path?: string;
  callback_url?: string;
  dmPolicy?: "open" | "allowlist" | "pairing" | "disabled";
  allowFrom?: Array<string | number>;
  accounts?: Record<string, Partial<DouyinChannelConfig>>;
};

/** 与历史代码/工具层兼容的别名（同 DouyinChannelConfig） */
export type DouyinAccountConfig = DouyinChannelConfig;

/** 单账号解析结果（供渠道插件使用） */
export type ResolvedDouyinAccount = {
  accountId: string;
  enabled: boolean;
  /** 是否具备 app_key + app_secret */
  configured: boolean;
  app_key: string;
  app_secret: string;
  shop_id?: string;
  webhook_path: string;
  config: DouyinChannelConfig;
};

/** 简易工具描述（供 registerTool 注册，与 OpenClaw 工具形态对齐） */
export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
};
