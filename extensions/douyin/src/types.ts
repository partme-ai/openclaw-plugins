/**
 * 抖音渠道类型定义。
 *
 * **架构角色**：描述 `channels.douyin` 配置形态、账号解析结果与工具注册契约，
 * 供 config / channel / tools 模块共享。
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

/** 单账号解析结果（config 模块产出，channel / inbound 消费） */
export type ResolvedDouyinAccount = {
  /** 规范化后的账号 id（如 default、shop-a） */
  accountId: string;
  /** 是否启用该账号的 Gateway Webhook */
  enabled: boolean;
  /** 是否具备 app_key + app_secret，决定入站能否通过验签 */
  configured: boolean;
  /** 开放平台 client_key */
  app_key: string;
  /** 开放平台 client_secret，用于 Webhook 验签与 client_token */
  app_secret: string;
  /** 抖店/门店 id，用于 replyRoute 与匿名 peer 占位 */
  shop_id?: string;
  /** Gateway 注册的 HTTP 路径 */
  webhook_path: string;
  /** 未合并的 per-account 原始配置（含 dmPolicy、allowFrom） */
  config: DouyinChannelConfig;
};

/** Agent 工具定义（与 OpenClaw registerTool 形态对齐） */
export type ToolDefinition = {
  /** 工具唯一名称 */
  name: string;
  /** 供 LLM 选择的自然语言描述 */
  description: string;
  /** JSON Schema 风格参数定义 */
  parameters: Record<string, unknown>;
  /** 工具执行体；可异步调用 OpenAPI */
  execute: (args: Record<string, unknown>) => Promise<unknown>;
};
