/**
 * @partme.ai/openclaw-message-sdk — 统一消息格式 SDK + 公共工具库
 *
 * 所有 openclaw-plugins 渠道插件共享的基础能力：
 * - 统一消息类型与构造器
 * - 媒体解析器（Markdown/HTML/MEDIA:指令/裸露路径）
 * - HTTP 客户端 + 重试策略
 * - 腾讯云 ASR 语音识别
 * - 统一错误类型
 *
 * 零运行时必选依赖。ASR/HTTP 按需引入。
 */

// ── 核心消息类型（已在本文档定义，见下方代码） ──

// ── 媒体解析器 ──
export {
  extractMediaFromText,
  extractImagesFromText,
  extractFilesFromText,
  isHttpUrl,
  isLocalReference,
  normalizeLocalPath,
  isImagePath,
  isNonImageFilePath,
  getExtension,
  detectMediaTypeFromPath,
  type ExtractedMedia,
  type MediaParseResult,
  type MediaParseOptions,
  type MediaType,
} from "./media-parser.js";

// ── HTTP 客户端 + 重试 ──
export {
  httpPost,
  httpGet,
  withRetry,
  defaultShouldRetry,
  HttpError,
  TimeoutError,
  type HttpRequestOptions,
  type RetryOptions,
} from "./http-client.js";

// ── 腾讯云 ASR ──
export {
  transcribeTencentFlash,
  ASRError,
  ASRTimeoutError,
  ASRAuthError,
  ASRRequestError,
  ASRResponseParseError,
  ASRServiceError,
  ASREmptyResultError,
  type TencentFlashASRConfig,
  type ASRErrorKind,
} from "./asr-tencent.js";

// ============================================================================
// 媒体类型
// ============================================================================

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

// ============================================================================
// 统一消息体
// ============================================================================

export type MessageContentType = "text" | "markdown" | "mixed";
export type MessageDirection = "inbound" | "outbound";

export interface UnifiedMessage {
  messageId: string;
  traceId: string;
  timestamp: number;
  source: { channel: string; accountId: string; userId: string; chatType: "direct" | "group" };
  target?: { channels: string[]; routingRule?: string };
  contentType: MessageContentType;
  text: string;
  markdown?: string;
  media: MediaReference[];
  replyToMessageId?: string;
  metadata?: Record<string, unknown>;
  direction: MessageDirection;
}

// ============================================================================
// 媒体种类检测
// ============================================================================

export const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "tiff", "heic", "heif",
]);

export const VIDEO_EXTENSIONS = new Set([
  "mp4", "mov", "avi", "mkv", "webm", "flv", "wmv", "m4v",
]);

export const AUDIO_EXTENSIONS = new Set([
  "mp3", "wav", "ogg", "m4a", "amr", "flac", "aac", "opus", "wma",
]);

export const DOCUMENT_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "md", "rtf", "odt", "ods",
]);

export const ARCHIVE_EXTENSIONS = new Set([
  "zip", "rar", "7z", "tar", "gz", "tgz", "bz2",
]);

export function detectMediaKind(fileName: string): MediaKind {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (DOCUMENT_EXTENSIONS.has(ext)) return "document";
  if (ARCHIVE_EXTENSIONS.has(ext)) return "archive";
  return "other";
}

export function detectMediaKindFromMime(mimeType: string): MediaKind {
  const m = mimeType.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m.includes("pdf") || m.includes("document") || m.includes("msword") ||
      m.includes("excel") || m.includes("powerpoint") || m.includes("text/")) return "document";
  if (m.includes("zip") || m.includes("rar") || m.includes("tar") || m.includes("gzip") || m.includes("7z")) return "archive";
  return "other";
}

// ============================================================================
// 序列化 / 反序列化
// ============================================================================

export function serializeMessage(msg: UnifiedMessage): string {
  return JSON.stringify(msg);
}

export function deserializeMessage(json: string): UnifiedMessage {
  return JSON.parse(json) as UnifiedMessage;
}

/**
 * 安全反序列化（带校验和回退）
 * 返回 null 表示无效消息
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
 * 从任意输入解析（支持 string | Buffer | object）
 */
export function parseMessageAny(input: string | Buffer | Uint8Array | unknown): UnifiedMessage | null {
  if (typeof input === "string") return parseMessage(input);
  if (Buffer.isBuffer(input)) return parseMessage(input.toString("utf-8"));
  if (input instanceof Uint8Array) return parseMessage(new TextDecoder().decode(input));
  if (typeof input === "object" && input !== null) return input as UnifiedMessage;
  return null;
}

// ============================================================================
// ID 生成
// ============================================================================

export function generateTraceId(): string {
  const ts = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `${ts}-${r}`;
}

export function generateMessageId(channel?: string): string {
  const prefix = channel ? `${channel}-` : "";
  const ts = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}${ts}-${r}`;
}

// ============================================================================
// 消息构造器
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

export function buildTextMessage(channel: string, accountId: string, userId: string, text: string, chatType?: "direct" | "group"): UnifiedMessage {
  return buildMessage({ channel, accountId, userId, text, chatType });
}

export function buildMediaMessage(channel: string, accountId: string, userId: string, text: string, media: MediaReference[], chatType?: "direct" | "group"): UnifiedMessage {
  return buildMessage({ channel, accountId, userId, text, media, chatType });
}

// ============================================================================
// 媒体引用构建
// ============================================================================

export function createMediaRef(url: string, fileName?: string, sizeBytes?: number): MediaReference {
  return { url, kind: detectMediaKind(fileName ?? url), mimeType: "application/octet-stream", fileName, sizeBytes };
}

export function createImageRef(url: string, base64?: string, fileName?: string): MediaReference {
  const ext = fileName?.split(".").pop()?.toLowerCase() ?? "png";
  return { url, kind: "image", mimeType: `image/${ext === "jpg" ? "jpeg" : ext}`, fileName, base64 };
}

// ============================================================================
// 消息文本提取器
// ============================================================================

/**
 * 从统一消息中提取纯文本（含媒体占位符）
 * 用于不支持 Markdown 的渠道（如 Gotify、微信客服）
 */
export function extractPlainText(msg: UnifiedMessage): string {
  let text = msg.text;

  if (msg.markdown) {
    // Markdown → 纯文本降级
    text += "\n\n" + msg.markdown
      .replace(/#{1,6}\s+/g, "")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/!\[[^\]]*\]\([^)]+\)/g, "[图片]")
      .replace(/`{1,3}[^`]*`{1,3}/g, "")
      .replace(/[>\-*]\s/g, "");
  }

  if (msg.media.length > 0) {
    const parts = msg.media.map((m) => {
      switch (m.kind) {
        case "image": return `[图片: ${m.fileName ?? m.url}]`;
        case "video": return `[视频: ${m.fileName ?? m.url}]`;
        case "audio": return `[语音: ${m.fileName ?? m.url}]`;
        default: return `[文件: ${m.fileName ?? m.url}]`;
      }
    });
    text += "\n" + parts.join("\n");
  }

  return text.trim();
}

/**
 * 从统一消息中提取 Markdown（含媒体链接）
 * 用于支持 Markdown 的渠道（如钉钉、飞书、企微）
 */
export function extractMarkdown(msg: UnifiedMessage): string {
  let md = msg.markdown ?? msg.text;

  if (msg.media.length > 0) {
    const parts = msg.media.map((m) => {
      if (m.kind === "image") return `![${m.fileName ?? "image"}](${m.base64 ? "data:" + m.mimeType + ";base64," + m.base64 : m.url})`;
      return `📎 [${m.fileName ?? m.url}](${m.url})`;
    });
    md += "\n\n" + parts.join("\n");
  }

  return md.trim();
}

/**
 * 从消息文本中解析媒体引用
 *
 * 支持三种格式：
 * - Markdown 图片: ![alt](url)
 * - MEDIA: 指令:  MEDIA: /path/to/file
 * - 裸露 URL:   https://cdn.example.com/file.pdf
 */
export function parseMediaFromText(text: string): MediaReference[] {
  const media: MediaReference[] = [];
  const seen = new Set<string>();

  // 1. Markdown 图片 ![...](url)
  const mdImageRe = /!\[([^\]]*)\]\(([^)]+)\)/g;
  for (const m of text.matchAll(mdImageRe)) {
    const url = m[2];
    if (!seen.has(url)) {
      seen.add(url);
      media.push(createMediaRef(url, m[1] || undefined));
    }
  }

  // 2. MEDIA: /path 指令
  const mediaRe = /^MEDIA:\s*`?([^\n`]+?)`?\s*$/gm;
  for (const m of text.matchAll(mediaRe)) {
    const url = m[1].trim();
    if (!seen.has(url)) {
      seen.add(url);
      media.push(createMediaRef(url));
    }
  }

  // 3. 裸露的 HTTP URL
  const urlRe = /https?:\/\/\S+\.(png|jpg|jpeg|gif|webp|svg|mp4|mov|mp3|wav|pdf|docx?|xlsx?|pptx?|zip)(\?\S*)?/gi;
  for (const m of text.matchAll(urlRe)) {
    const url = m[0];
    if (!seen.has(url)) {
      seen.add(url);
      media.push(createMediaRef(url));
    }
  }

  return media;
}

// ============================================================================
// 错误类型（统一用于所有渠道插件）
// ============================================================================

/**
 * 文件大小超限错误
 *
 * 当媒体文件超过平台允许的大小时抛出。供渠道插件统一使用。
 */
export class FileSizeLimitError extends Error {
  readonly actualSize: number;
  readonly limitSize: number;
  readonly mediaKind: MediaKind;

  constructor(actualSize: number, limitSize: number, mediaKind: MediaKind) {
    const sizeMB = (actualSize / (1024 * 1024)).toFixed(2);
    const limitMB = (limitSize / (1024 * 1024)).toFixed(0);
    super(`文件大小 ${sizeMB}MB 超过 ${mediaKind} 类型限制 ${limitMB}MB`);
    this.name = "FileSizeLimitError";
    this.actualSize = actualSize;
    this.limitSize = limitSize;
    this.mediaKind = mediaKind;
  }
}

/**
 * 媒体操作超时错误
 *
 * 当媒体下载/上传超过指定时间时抛出。
 */
export class MediaTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`媒体操作超时 (${timeoutMs}ms)`);
    this.name = "MediaTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * 消息解析错误
 *
 * 当 parseMessage 或 parseMessageAny 返回 null 时，可抛出此错误供上层处理。
 */
export class MessageParseError extends Error {
  readonly rawInput: string;

  constructor(rawInput: string, reason?: string) {
    super(`消息解析失败: ${reason ?? "无效的格式"}`);
    this.name = "MessageParseError";
    this.rawInput = rawInput;
  }
}

// ============================================================================
// 从子模块重导出
// ============================================================================
//
// 核心消息类型与函数已在本文档定义（上方）。
// 以下模块可从 '@partme.ai/openclaw-message-sdk' 统一导入：
//
//   import { UnifiedMessage, buildMessage, parseMessage,
//            extractImagesFromText, httpPost, withRetry,
//            transcribeTencentFlash, ASRError } from "@partme.ai/openclaw-message-sdk";
//
// 也可以按子路径导入：
//   import { extractImagesFromText } from "@partme.ai/openclaw-message-sdk/media";
//   import { httpPost, withRetry } from "@partme.ai/openclaw-message-sdk/http";
//   import { transcribeTencentFlash } from "@partme.ai/openclaw-message-sdk/asr";
//   import { resolveFileCategory } from "@partme.ai/openclaw-message-sdk/file";

// ── 媒体（解析 + IO）──
export * from "./media/index.js";

// ── HTTP（客户端 + 重试）──
export * from "./http/index.js";

// ── ASR（语音识别）──
export * from "./asr/index.js";

// ── 文件工具 ──
export * from "./file/index.js";
