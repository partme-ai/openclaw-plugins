/**
 * @partme.ai/openclaw-message-sdk — 统一消息格式 SDK
 *
 * 零运行时依赖的纯类型定义 + 序列化工具。
 * 所有 openclaw-plugins 的渠道插件使用此格式进行互通。
 *
 * 设计原则：
 * - 消息体不包含文件二进制数据，只包含文件访问地址 (URL/path)
 * - 图片可选用 base64 内联传输（小图场景）
 * - 支持 text / markdown / mixed 三种内容类型
 * - 与 openclaw-china 的 ExtractedMedia / MediaParseResult 对齐
 */

// ============================================================================
// 媒体类型
// ============================================================================

/** 媒体种类 */
export type MediaKind = "image" | "video" | "audio" | "document" | "archive" | "other";

/** 媒体引用（不含二进制数据） */
export interface MediaReference {
  /** 访问地址（http/https URL 或 file:// 路径） */
  url: string;
  /** 媒体种类 */
  kind: MediaKind;
  /** MIME 类型（如 image/png, application/pdf） */
  mimeType: string;
  /** 文件名 */
  fileName?: string;
  /** 文件大小（字节），可选 */
  sizeBytes?: number;
  /** 图片 base64 内联数据（仅 image 类型可选提供） */
  base64?: string;
  /** 缩略图 URL（视频/图片可选） */
  thumbnailUrl?: string;
  /** 时长（秒），audio/video 可选 */
  durationSeconds?: number;
  /** 宽高（像素），image/video 可选 */
  width?: number;
  height?: number;
}

// ============================================================================
// 统一消息体
// ============================================================================

/** 消息内容类型 */
export type MessageContentType = "text" | "markdown" | "mixed";

/** 消息方向 */
export type MessageDirection = "inbound" | "outbound";

/**
 * 统一消息体
 *
 * 所有渠道插件（IM、MQ、Gotify 等）之间的标准互通格式。
 */
export interface UnifiedMessage {
  // ── 消息标识 ──
  /** 消息唯一 ID（由来源插件生成） */
  messageId: string;
  /** 追踪 ID（跨渠道路由时保持不变） */
  traceId: string;
  /** 消息时间戳（毫秒） */
  timestamp: number;

  // ── 来源信息 ──
  source: {
    /** 渠道 ID（wecom, mqtt, gotify, ...） */
    channel: string;
    /** 账号 ID */
    accountId: string;
    /** 发送者 ID */
    userId: string;
    /** 会话类型 */
    chatType: "direct" | "group";
  };

  // ── 目标信息（路由后填充） ──
  target?: {
    /** 目标渠道列表 */
    channels: string[];
    /** 触发的路由规则名 */
    routingRule?: string;
  };

  // ── 内容 ──
  /** 内容类型 */
  contentType: MessageContentType;
  /** 文本内容（text/markdown 模式下的主体，mixed 模式下的文本部分） */
  text: string;
  /** Markdown 内容（contentType="markdown" 时使用） */
  markdown?: string;
  /** 媒体附件列表（文件引用，不含二进制） */
  media: MediaReference[];
  /** 引用消息 ID（回复场景） */
  replyToMessageId?: string;

  // ── 元数据 ──
  /** 扩展元数据（业务系统透传） */
  metadata?: Record<string, unknown>;
  /** 消息方向 */
  direction: MessageDirection;
}

// ============================================================================
// 内容类型检测
// ============================================================================

/** 图片扩展名集合 */
export const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "tiff", "heic", "heif",
]);

/** 视频扩展名集合 */
export const VIDEO_EXTENSIONS = new Set([
  "mp4", "mov", "avi", "mkv", "webm", "flv", "wmv", "m4v",
]);

/** 音频扩展名集合 */
export const AUDIO_EXTENSIONS = new Set([
  "mp3", "wav", "ogg", "m4a", "amr", "flac", "aac", "opus", "wma",
]);

/** 文档扩展名集合 */
export const DOCUMENT_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "txt", "csv", "md", "rtf", "odt", "ods",
]);

/** 压缩包扩展名集合 */
export const ARCHIVE_EXTENSIONS = new Set([
  "zip", "rar", "7z", "tar", "gz", "tgz", "bz2",
]);

/**
 * 根据文件扩展名检测媒体种类
 */
export function detectMediaKind(fileName: string): MediaKind {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (DOCUMENT_EXTENSIONS.has(ext)) return "document";
  if (ARCHIVE_EXTENSIONS.has(ext)) return "archive";
  return "other";
}

/**
 * 根据 MIME 类型检测媒体种类
 */
export function detectMediaKindFromMime(mimeType: string): MediaKind {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.includes("pdf") || mime.includes("document") || mime.includes("msword") ||
      mime.includes("excel") || mime.includes("powerpoint") || mime.includes("text/")) return "document";
  if (mime.includes("zip") || mime.includes("rar") || mime.includes("tar") ||
      mime.includes("gzip") || mime.includes("7z")) return "archive";
  return "other";
}

// ============================================================================
// 消息序列化
// ============================================================================

/**
 * 序列化为 JSON 字符串（用于 MQ 传输）
 */
export function serializeMessage(msg: UnifiedMessage): string {
  return JSON.stringify(msg);
}

/**
 * 从 JSON 字符串反序列化
 */
export function deserializeMessage(json: string): UnifiedMessage {
  return JSON.parse(json) as UnifiedMessage;
}

/**
 * 生成唯一 traceId
 */
export function generateTraceId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${ts}-${rand}`;
}

/**
 * 生成唯一 messageId
 */
export function generateMessageId(channel?: string): string {
  const prefix = channel ? `${channel}-` : "";
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}${ts}-${rand}`;
}

// ============================================================================
// 消息构建器
// ============================================================================

export interface BuildMessageParams {
  channel: string;
  accountId: string;
  userId: string;
  chatType?: "direct" | "group";
  text?: string;
  markdown?: string;
  media?: MediaReference[];
  replyToMessageId?: string;
  metadata?: Record<string, unknown>;
  direction?: MessageDirection;
}

/**
 * 快速构建统一消息
 */
export function buildMessage(params: BuildMessageParams): UnifiedMessage {
  const hasMedia = (params.media?.length ?? 0) > 0;
  const hasText = Boolean(params.text);
  const hasMarkdown = Boolean(params.markdown);

  let contentType: MessageContentType = "text";
  if (hasMedia && (hasText || hasMarkdown)) contentType = "mixed";
  else if (hasMarkdown) contentType = "markdown";

  return {
    messageId: generateMessageId(params.channel),
    traceId: generateTraceId(),
    timestamp: Date.now(),
    source: {
      channel: params.channel,
      accountId: params.accountId,
      userId: params.userId,
      chatType: params.chatType ?? "direct",
    },
    contentType,
    text: params.text ?? "",
    markdown: params.markdown,
    media: params.media ?? [],
    replyToMessageId: params.replyToMessageId,
    metadata: params.metadata,
    direction: params.direction ?? "inbound",
  };
}

/**
 * 构建仅文本消息
 */
export function buildTextMessage(
  channel: string, accountId: string, userId: string,
  text: string, chatType?: "direct" | "group",
): UnifiedMessage {
  return buildMessage({ channel, accountId, userId, text, chatType });
}

/**
 * 构建带媒体的消息
 */
export function buildMediaMessage(
  channel: string, accountId: string, userId: string,
  text: string, media: MediaReference[], chatType?: "direct" | "group",
): UnifiedMessage {
  return buildMessage({ channel, accountId, userId, text, media, chatType });
}

// ============================================================================
// 媒体引用构建辅助
// ============================================================================

/**
 * 根据文件 URL 创建媒体引用
 */
export function createMediaRef(url: string, fileName?: string, sizeBytes?: number): MediaReference {
  return {
    url,
    kind: detectMediaKind(fileName ?? url),
    mimeType: "application/octet-stream",
    fileName,
    sizeBytes,
  };
}

/**
 * 创建图片引用（含 base64）
 */
export function createImageRef(url: string, base64?: string, fileName?: string): MediaReference {
  const ext = fileName?.split(".").pop()?.toLowerCase() ?? "png";
  return {
    url,
    kind: "image",
    mimeType: `image/${ext === "jpg" ? "jpeg" : ext}`,
    fileName,
    base64,
  };
}
