/**
 * @module core/types
 *
 * 统一消息核心类型定义（Unified Message Core Types）。
 *
 * **职责**：定义所有渠道插件共享的消息体、媒体引用、传输信封与解析结果契约。
 *
 * **适用场景**：MQ Wire 插件、IM Transcript 插件、bridge/dispatch 层入参出参。
 *
 * **关键导出**：`UnifiedMessage`、`MessageEnvelope`、`MediaReference`、`BuildMessageParams`
 */

/** 媒体种类 / Media kind classification */
export type MediaKind = "image" | "video" | "audio" | "document" | "archive" | "other";

/**
 * 媒体引用结构 / Structured media attachment reference.
 *
 * 用于在 UnifiedMessage 中携带图片、音视频、文档等附件元数据。
 */
export interface MediaReference {
  /** 可访问 URL / Accessible URL */
  url: string;
  /** 媒体种类 / Media kind */
  kind: MediaKind;
  /** MIME 类型 / MIME type */
  mimeType: string;
  /** 原始文件名 / Original file name */
  fileName?: string;
  /** 字节大小 / Size in bytes */
  sizeBytes?: number;
  /** Base64 内联数据（小图场景）/ Inline base64 payload for small images */
  base64?: string;
  /** 缩略图 URL / Thumbnail URL */
  thumbnailUrl?: string;
  /** 时长（秒）/ Duration in seconds */
  durationSeconds?: number;
  /** 宽度（像素）/ Width in pixels */
  width?: number;
  /** 高度（像素）/ Height in pixels */
  height?: number;
}

/** 消息内容类型 / Message content type */
export type MessageContentType = "text" | "markdown" | "mixed";

/** 消息方向 / Message direction */
export type MessageDirection = "inbound" | "outbound";

/**
 * 消息来源 / Message source identity.
 *
 * 与 bridge 插件对齐，可选携带路由到的 agentId（MQ/bridge 场景）。
 */
export interface UnifiedMessageSource {
  /** 渠道标识，如 wecom、feishu、rabbitmq / Channel id */
  channel: string;
  /** 账号 ID / Account id */
  accountId: string;
  /** 发送者或 peer ID / Sender or peer id */
  userId: string;
  /** 会话类型 / Chat type */
  chatType: "direct" | "group";
  /** 路由到的智能体 ID（MQ/bridge 场景）/ Routed agent id */
  agentId?: string;
}

/**
 * 消息投递目标 / Message routing target.
 *
 * 多通道广播或规则路由时使用。
 */
export interface UnifiedMessageTarget {
  /** 目标渠道列表 / Target channel ids */
  channels: string[];
  /** 路由规则标识 / Routing rule id */
  routingRule?: string;
}

/**
 * 统一消息体 / Unified message envelope payload.
 *
 * 所有渠道插件入站/出站的标准 JSON 结构，替代各插件自定义 message shape。
 */
export interface UnifiedMessage {
  /** 消息唯一 ID / Unique message id */
  messageId: string;
  /** 链路追踪 ID / Trace id for observability */
  traceId: string;
  /** Unix 毫秒时间戳 / Unix timestamp in ms */
  timestamp: number;
  /** 来源信息 / Source identity */
  source: UnifiedMessageSource;
  /** 可选投递目标 / Optional routing target */
  target?: UnifiedMessageTarget;
  /** 内容类型 / Content type */
  contentType: MessageContentType;
  /** 纯文本正文 / Plain text body */
  text: string;
  /** Markdown 正文（与 text 可并存）/ Markdown body */
  markdown?: string;
  /** 附件列表 / Media attachments */
  media: MediaReference[];
  /** 回复的消息 ID / Reply-to message id */
  replyToMessageId?: string;
  /** 扩展元数据（correlationId、idempotencyKey 等）/ Extension metadata */
  metadata?: Record<string, unknown>;
  /** 入站或出站 / Direction */
  direction: MessageDirection;
}

/**
 * 传输层回复路由 / Reply route for outbound publish.
 *
 * 写入信封 headers，供 MQ 出站 publish 时使用（topic、routingKey、queue 等）。
 */
export interface ReplyRoute {
  topic?: string;
  routingKey?: string;
  exchange?: string;
  destination?: string;
  queue?: string;
  [key: string]: string | undefined;
}

/**
 * 版本化线传输信封 headers / Wire envelope headers (version 1).
 */
export interface MessageEnvelopeHeaders {
  /** 关联 ID / Correlation id */
  correlationId?: string;
  /** 幂等键 / Idempotency key */
  idempotencyKey?: string;
  /** 出站回复路由 / Outbound reply route */
  replyRoute?: ReplyRoute;
  /** 编码方式 / Encoding hint */
  encoding?: "json" | "plain";
  [key: string]: string | ReplyRoute | undefined;
}

/**
 * 版本化线传输信封 / Versioned wire transport envelope.
 *
 * 入栈/出栈载体，version 固定为 `"1"`。
 */
export interface MessageEnvelope {
  /** 信封版本 / Envelope version */
  version: "1";
  /** 内嵌统一消息 / Embedded unified message */
  message: UnifiedMessage;
  /** 传输层 headers / Transport headers */
  headers?: MessageEnvelopeHeaders;
}

/**
 * 载荷解析模式 / Payload parse mode for transport layer.
 *
 * - `plain`：整段当作纯文本
 * - `jsonTextOrPlain`：优先 JSON/envelope，失败回退 plain
 * - `jsonOnly`：仅接受 JSON，无有效 JSON 时返回空文本
 */
export type PayloadParseMode = "plain" | "jsonTextOrPlain" | "jsonOnly";

/**
 * 传输层解析结果 / Parsed transport payload result.
 */
export interface ParsedTransportPayload {
  /** 提取的可发送文本 / Extracted sendable text */
  text: string;
  /** 解析出的 UnifiedMessage，legacy/plain 时为 null / Parsed unified message or null */
  unified: UnifiedMessage | null;
  /** 关联 ID / Correlation id */
  correlationId?: string;
  /** 幂等键 / Idempotency key */
  idempotencyKey?: string;
  /** 回复路由 / Reply route from envelope headers */
  replyRoute?: ReplyRoute;
}

/**
 * buildMessage 构造参数 / Parameters for building a UnifiedMessage.
 */
export interface BuildMessageParams {
  /** 渠道 ID / Channel id */
  channel: string;
  /** 账号 ID / Account id */
  accountId: string;
  /** 用户/peer ID / User or peer id */
  userId: string;
  /** 可选 agent ID / Optional agent id */
  agentId?: string;
  /** 会话类型，默认 direct / Chat type, default direct */
  chatType?: "direct" | "group";
  /** 纯文本 / Plain text */
  text?: string;
  /** Markdown 正文 / Markdown body */
  markdown?: string;
  /** 媒体附件 / Media attachments */
  media?: MediaReference[];
  /** 回复目标消息 ID / Reply-to message id */
  replyToMessageId?: string;
  /** 扩展元数据 / Extension metadata */
  metadata?: Record<string, unknown>;
  /** 方向，默认 inbound / Direction, default inbound */
  direction?: MessageDirection;
}
