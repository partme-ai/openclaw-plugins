/**
 * @module core/message
 *
 * UnifiedMessage 构造、序列化、解析与文本/媒体提取。
 *
 * **职责**：提供 messageId/traceId 生成、buildMessage 工厂、JSON 序列化/反序列化、
 * 纯文本/Markdown 提取、从文本解析媒体链接。
 *
 * **关键导出**：`buildMessage`、`parseMessage`、`extractPlainText`、`detectMediaKind`
 */

import type {
  MediaKind,
  MediaReference,
  MessageContentType,
  UnifiedMessage,
} from "./types.js";
import type { BuildMessageParams } from "./types.js";

/** 重新导出构造参数类型 / Re-export build params type */
export type { BuildMessageParams } from "./types.js";

// ============================================================================
// 扩展名 → MediaKind 映射常量 / Extension → MediaKind sets
// ============================================================================

/** 图片扩展名集合 / Image file extensions */
export const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "tiff", "heic", "heif",
]);

/** 视频扩展名集合 / Video file extensions */
export const VIDEO_EXTENSIONS = new Set([
  "mp4", "mov", "avi", "mkv", "webm", "flv", "wmv", "m4v",
]);

/** 音频扩展名集合 / Audio file extensions */
export const AUDIO_EXTENSIONS = new Set([
  "mp3", "wav", "ogg", "m4a", "amr", "flac", "aac", "opus", "wma",
]);

/** 文档扩展名集合 / Document file extensions */
export const DOCUMENT_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "md", "rtf", "odt", "ods",
]);

/** 压缩包扩展名集合 / Archive file extensions */
export const ARCHIVE_EXTENSIONS = new Set([
  "zip", "rar", "7z", "tar", "gz", "tgz", "bz2",
]);

/**
 * 根据文件名扩展名推断媒体种类 / Detect media kind from file name extension.
 *
 * @param fileName - 文件名或 URL 路径 / File name or URL path
 * @returns 推断的 MediaKind，未知时为 other
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
 * 根据 MIME 类型推断媒体种类 / Detect media kind from MIME type string.
 *
 * @param mimeType - MIME 类型，如 image/png / MIME type string
 * @returns 推断的 MediaKind
 */
export function detectMediaKindFromMime(mimeType: string): MediaKind {
  const m = mimeType.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (
    m.includes("pdf") ||
    m.includes("document") ||
    m.includes("msword") ||
    m.includes("excel") ||
    m.includes("powerpoint") ||
    m.includes("text/")
  ) {
    return "document";
  }
  if (m.includes("zip") || m.includes("rar") || m.includes("tar") || m.includes("gzip") || m.includes("7z")) {
    return "archive";
  }
  return "other";
}

/**
 * 将 UnifiedMessage 序列化为 JSON 字符串 / Serialize UnifiedMessage to JSON string.
 *
 * @param msg - 统一消息体 / Unified message
 * @returns JSON 字符串
 */
export function serializeMessage(msg: UnifiedMessage): string {
  return JSON.stringify(msg);
}

/**
 * 从 JSON 字符串反序列化 UnifiedMessage / Deserialize UnifiedMessage from JSON string.
 *
 * @param json - JSON 字符串 / JSON string
 * @returns 解析后的 UnifiedMessage（不做 schema 校验）
 */
export function deserializeMessage(json: string): UnifiedMessage {
  return JSON.parse(json) as UnifiedMessage;
}

/**
 * 尝试从 JSON 字符串解析 UnifiedMessage / Parse UnifiedMessage from JSON with validation.
 *
 * 校验 messageId、source.channel、text 字段；无效时返回 null。
 *
 * @param input - JSON 字符串 / JSON string
 * @returns 有效 UnifiedMessage 或 null
 */
export function parseMessage(input: string): UnifiedMessage | null {
  try {
    const obj = JSON.parse(input);
    if (!obj || typeof obj !== "object") return null;
    if (!obj.messageId || !obj.source?.channel) return null;
    if (typeof obj.text !== "string") return null;
    return obj as UnifiedMessage;
  } catch {
    return null;
  }
}

/**
 * 从多种输入形态解析 UnifiedMessage / Parse UnifiedMessage from string, Buffer, or object.
 *
 * 支持：UTF-8 字符串、Buffer、Uint8Array、已解析对象（含 envelope.message 嵌套）。
 *
 * @param input - 原始输入 / Raw input
 * @returns 有效 UnifiedMessage 或 null
 */
export function parseMessageAny(input: string | Buffer | Uint8Array | unknown): UnifiedMessage | null {
  if (typeof input === "string") return parseMessage(input);
  if (Buffer.isBuffer(input)) return parseMessage(input.toString("utf-8"));
  if (input instanceof Uint8Array) return parseMessage(new TextDecoder().decode(input));
  if (typeof input === "object" && input !== null) {
    const o = input as Record<string, unknown>;
    // 兼容 envelope 嵌套：{ message: UnifiedMessage }
    if (o.message && typeof o.message === "object") {
      return (o.message as UnifiedMessage) ?? null;
    }
    return input as UnifiedMessage;
  }
  return null;
}

/**
 * 生成链路追踪 ID / Generate trace id (timestamp + random).
 *
 * @returns 形如 `{ts36}-{random}` 的 trace id
 */
export function generateTraceId(): string {
  const ts = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `${ts}-${r}`;
}

/**
 * 生成消息 ID / Generate message id with optional channel prefix.
 *
 * @param channel - 可选渠道前缀 / Optional channel prefix
 * @returns 唯一 messageId
 */
export function generateMessageId(channel?: string): string {
  const prefix = channel ? `${channel}-` : "";
  const ts = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}${ts}-${r}`;
}

/**
 * 根据参数构造完整 UnifiedMessage / Build a UnifiedMessage from params.
 *
 * 自动推断 contentType（text / markdown / mixed）并生成 messageId、traceId、timestamp。
 *
 * @param params - 构造参数 / Build parameters
 * @returns 新的 UnifiedMessage
 */
export function buildMessage(params: BuildMessageParams): UnifiedMessage {
  const hasMedia = (params.media?.length ?? 0) > 0;
  const hasText = Boolean(params.text);
  const hasMarkdown = Boolean(params.markdown);

  // 推断内容类型：有媒体且有多模态文本 → mixed；仅 markdown → markdown；否则 text
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
      ...(params.agentId ? { agentId: params.agentId } : {}),
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
 * 快捷构造纯文本 UnifiedMessage / Build a plain text UnifiedMessage.
 *
 * @param channel - 渠道 ID
 * @param accountId - 账号 ID
 * @param userId - 用户 ID
 * @param text - 文本内容
 * @param chatType - 会话类型，默认 direct
 * @returns 纯文本 UnifiedMessage
 */
export function buildTextMessage(
  channel: string,
  accountId: string,
  userId: string,
  text: string,
  chatType?: "direct" | "group",
): UnifiedMessage {
  return buildMessage({ channel, accountId, userId, text, chatType });
}

/**
 * 快捷构造带媒体的 UnifiedMessage / Build a UnifiedMessage with media attachments.
 *
 * @param channel - 渠道 ID
 * @param accountId - 账号 ID
 * @param userId - 用户 ID
 * @param text - 伴随文本
 * @param media - 媒体引用列表
 * @param chatType - 会话类型
 * @returns 带 media 附件的 UnifiedMessage
 */
export function buildMediaMessage(
  channel: string,
  accountId: string,
  userId: string,
  text: string,
  media: MediaReference[],
  chatType?: "direct" | "group",
): UnifiedMessage {
  return buildMessage({ channel, accountId, userId, text, media, chatType });
}

/**
 * 创建通用媒体引用 / Create a MediaReference from URL and optional metadata.
 *
 * @param url - 媒体 URL
 * @param fileName - 可选文件名（用于 kind 推断）
 * @param sizeBytes - 可选字节大小
 * @returns MediaReference
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
 * 创建图片媒体引用 / Create an image MediaReference.
 *
 * @param url - 图片 URL
 * @param base64 - 可选内联 base64
 * @param fileName - 可选文件名（用于 MIME 推断）
 * @returns kind=image 的 MediaReference
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

/**
 * 提取 Agent 可用的纯文本（含 Markdown 降级与媒体占位）/ Extract plain text for Agent prompt.
 *
 * 合并 text、简化后的 markdown、媒体占位符（[图片: …] 等）。
 *
 * @param msg - 统一消息 / Unified message
 * @returns  Trim 后的纯文本
 */
export function extractPlainText(msg: UnifiedMessage): string {
  let text = msg.text;

  // Markdown → 简化纯文本：去标题/粗体/链接/代码块等标记
  if (msg.markdown) {
    text +=
      "\n\n" +
      msg.markdown
        .replace(/#{1,6}\s+/g, "")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/!\[[^\]]*\]\([^)]+\)/g, "[图片]")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/`{1,3}[^`]*`{1,3}/g, "")
        .replace(/[>\-*]\s/g, "");
  }

  // 媒体附件追加人类可读占位行
  if (msg.media.length > 0) {
    const parts = msg.media.map((m) => {
      switch (m.kind) {
        case "image":
          return `[图片: ${m.fileName ?? m.url}]`;
        case "video":
          return `[视频: ${m.fileName ?? m.url}]`;
        case "audio":
          return `[语音: ${m.fileName ?? m.url}]`;
        default:
          return `[文件: ${m.fileName ?? m.url}]`;
      }
    });
    text += "\n" + parts.join("\n");
  }

  return text.trim();
}

/**
 * 提取 Markdown 表示（含媒体链接）/ Extract Markdown representation with media links.
 *
 * @param msg - 统一消息
 * @returns Markdown 字符串
 */
export function extractMarkdown(msg: UnifiedMessage): string {
  let md = msg.markdown ?? msg.text;

  if (msg.media.length > 0) {
    const parts = msg.media.map((m) => {
      if (m.kind === "image") {
        return `![${m.fileName ?? "image"}](${m.base64 ? "data:" + m.mimeType + ";base64," + m.base64 : m.url})`;
      }
      return `📎 [${m.fileName ?? m.url}](${m.url})`;
    });
    md += "\n\n" + parts.join("\n");
  }

  return md.trim();
}

/**
 * 从文本中解析媒体引用（Markdown 图片、MEDIA: 行、URL 正则）/ Parse media refs from free text.
 *
 * 去重后返回 MediaReference 列表；用于 Agent 回复或用户消息中的隐式媒体链接。
 *
 * @param text - 原始文本
 * @returns 解析出的媒体列表
 */
export function parseMediaFromText(text: string): MediaReference[] {
  const media: MediaReference[] = [];
  const seen = new Set<string>();

  // Markdown 图片语法 ![alt](url)
  const mdImageRe = /!\[([^\]]*)\]\(([^)]+)\)/g;
  for (const m of text.matchAll(mdImageRe)) {
    const url = m[2];
    if (!seen.has(url)) {
      seen.add(url);
      media.push(createMediaRef(url, m[1] || undefined));
    }
  }

  // OpenClaw MEDIA: 行协议
  const mediaRe = /^MEDIA:\s*`?([^\n`]+?)`?\s*$/gm;
  for (const m of text.matchAll(mediaRe)) {
    const url = m[1].trim();
    if (!seen.has(url)) {
      seen.add(url);
      media.push(createMediaRef(url));
    }
  }

  // 常见媒体/文档 URL 后缀
  const urlRe =
    /https?:\/\/\S+\.(png|jpg|jpeg|gif|webp|svg|mp4|mov|mp3|wav|pdf|docx?|xlsx?|pptx?|zip)(\?\S*)?/gi;
  for (const m of text.matchAll(urlRe)) {
    const url = m[0];
    if (!seen.has(url)) {
      seen.add(url);
      media.push(createMediaRef(url));
    }
  }

  return media;
}

/**
 * 消息解析失败错误 / Error thrown when message parsing fails irrecoverably.
 */
export class MessageParseError extends Error {
  /** 原始输入 / Raw input that failed to parse */
  readonly rawInput: string;

  /**
   * @param rawInput - 无法解析的原始字符串
   * @param reason - 可选失败原因描述
   */
  constructor(rawInput: string, reason?: string) {
    super(`消息解析失败: ${reason ?? "无效的格式"}`);
    this.name = "MessageParseError";
    this.rawInput = rawInput;
  }
}
