/** Media kind classification. */
export type MediaKind = "image" | "video" | "audio" | "document" | "archive" | "other";

/** Structured media attachment reference. */
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

/** Message source identity. */
export interface UnifiedMessageSource {
  channel: string;
  accountId: string;
  userId: string;
  chatType: "direct" | "group";
  agentId?: string;
}

/** Message routing target. */
export interface UnifiedMessageTarget {
  channels: string[];
  routingRule?: string;
}

/** Unified message body (legacy wire shape). */
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

/** Reply route for outbound publish. */
export interface ReplyRoute {
  topic?: string;
  routingKey?: string;
  exchange?: string;
  destination?: string;
  queue?: string;
  [key: string]: string | undefined;
}

/** Wire envelope headers (version 1). */
export interface MessageEnvelopeHeaders {
  correlationId?: string;
  idempotencyKey?: string;
  replyRoute?: ReplyRoute;
  encoding?: "json" | "plain";
  [key: string]: unknown;
}

/** Versioned wire transport envelope. */
export interface MessageEnvelope {
  version: "1";
  message: UnifiedMessage;
  headers?: MessageEnvelopeHeaders;
}

/** Payload parse mode for transport layer. */
export type PayloadParseMode = "plain" | "jsonTextOrPlain" | "jsonOnly";

/** Parsed transport payload result. */
export interface ParsedTransportPayload {
  text: string;
  unified: UnifiedMessage | null;
  correlationId?: string;
  idempotencyKey?: string;
  replyRoute?: ReplyRoute;
}

/** Outbound wire format. */
export type OutboundWireFormat = "envelope" | "legacyJsonText" | "plainText";

/** Parameters for building a UnifiedMessage. */
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

/** Parameters for outbound serialization. */
export interface SerializeOutboundParams {
  channel: string;
  accountId: string;
  userId: string;
  text: string;
  agentId?: string;
  format?: OutboundWireFormat;
  headers?: MessageEnvelopeHeaders;
  replyRoute?: ReplyRoute;
}
