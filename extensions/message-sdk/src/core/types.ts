/**
 * 统一消息核心类型（所有渠道插件共享）。
 */

export type MediaKind = "image" | "video" | "audio" | "document" | "archive" | "other";

/**
 * MediaReference 描述 core 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface MediaReference {
  url: string;
  kind: MediaKind;
  mimeType: string;
  fileName?: string;
  sizeBytes?: number;
  base64?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
}

/**
 * MessageContentType 是 core 模块的公开类型别名。
 *
 * 该类型用于收窄调用边界，确保不同通道插件复用同一套 SDK 契约。
 */
export type MessageContentType = "text" | "markdown" | "mixed";
/**
 * MessageDirection 是 core 模块的公开类型别名。
 *
 * 该类型用于收窄调用边界，确保不同通道插件复用同一套 SDK 契约。
 */
export type MessageDirection = "inbound" | "outbound";

/** 消息来源（与 bridge 插件对齐：可选 agentId）。 */
export interface UnifiedMessageSource {
  channel: string;
  accountId: string;
  userId: string;
  chatType: "direct" | "group";
  /** 路由到的智能体 ID（MQ/bridge 场景）。 */
  agentId?: string;
}

/**
 * UnifiedMessageTarget 描述 core 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface UnifiedMessageTarget {
  channels: string[];
  routingRule?: string;
}

/**
 * UnifiedMessage 描述 core 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface UnifiedMessage {
  messageId: string;
  traceId: string;
  timestamp: number;
  source: UnifiedMessageSource;
  target?: UnifiedMessageTarget;
  contentType: MessageContentType;
  text: string;
  markdown?: string;
  media: MediaReference[];
  replyToMessageId?: string;
  metadata?: Record<string, unknown>;
  direction: MessageDirection;
}

/** 传输层回复路由（写入信封 headers，供出站 publish 使用）。 */
export interface ReplyRoute {
  topic?: string;
  routingKey?: string;
  exchange?: string;
  destination?: string;
  queue?: string;
  [key: string]: string | undefined;
}

/** 版本化线传输信封（入栈/出栈载体）。 */
export interface MessageEnvelopeHeaders {
  correlationId?: string;
  idempotencyKey?: string;
  replyRoute?: ReplyRoute;
  encoding?: "json" | "plain";
  [key: string]: string | ReplyRoute | undefined;
}

/**
 * MessageEnvelope 描述 core 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface MessageEnvelope {
  version: "1";
  message: UnifiedMessage;
  headers?: MessageEnvelopeHeaders;
}

/**
 * PayloadParseMode 是 core 模块的公开类型别名。
 *
 * 该类型用于收窄调用边界，确保不同通道插件复用同一套 SDK 契约。
 */
export type PayloadParseMode = "plain" | "jsonTextOrPlain" | "jsonOnly";

/**
 * ParsedTransportPayload 描述 core 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface ParsedTransportPayload {
  text: string;
  unified: UnifiedMessage | null;
  correlationId?: string;
  idempotencyKey?: string;
  replyRoute?: ReplyRoute;
}

/**
 * BuildMessageParams 描述 core 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface BuildMessageParams {
  channel: string;
  accountId: string;
  userId: string;
  agentId?: string;
  chatType?: "direct" | "group";
  text?: string;
  markdown?: string;
  media?: MediaReference[];
  replyToMessageId?: string;
  metadata?: Record<string, unknown>;
  direction?: MessageDirection;
}
