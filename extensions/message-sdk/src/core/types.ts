/**
 * 统一消息核心类型（所有渠道插件共享）。
 */

export type MediaKind = "image" | "video" | "audio" | "document" | "archive" | "other";

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

export type MessageContentType = "text" | "markdown" | "mixed";
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

export interface UnifiedMessageTarget {
  channels: string[];
  routingRule?: string;
}

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

export interface MessageEnvelope {
  version: "1";
  message: UnifiedMessage;
  headers?: MessageEnvelopeHeaders;
}

export type PayloadParseMode = "plain" | "jsonTextOrPlain" | "jsonOnly";

export interface ParsedTransportPayload {
  text: string;
  unified: UnifiedMessage | null;
  correlationId?: string;
  idempotencyKey?: string;
  replyRoute?: ReplyRoute;
}

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
