/**
 * UnifiedMessage 构造、序列化与文本提取。
 */

import type {
  MediaKind,
  MediaReference,
  MessageContentType,
  UnifiedMessage,
} from "./types.js";
import type { BuildMessageParams } from "./types.js";

export type { BuildMessageParams } from "./types.js";

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

export function serializeMessage(msg: UnifiedMessage): string {
  return JSON.stringify(msg);
}

export function deserializeMessage(json: string): UnifiedMessage {
  return JSON.parse(json) as UnifiedMessage;
}

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

export function parseMessageAny(input: string | Buffer | Uint8Array | unknown): UnifiedMessage | null {
  if (typeof input === "string") return parseMessage(input);
  if (Buffer.isBuffer(input)) return parseMessage(input.toString("utf-8"));
  if (input instanceof Uint8Array) return parseMessage(new TextDecoder().decode(input));
  if (typeof input === "object" && input !== null) {
    const o = input as Record<string, unknown>;
    if (o.message && typeof o.message === "object") {
      return (o.message as UnifiedMessage) ?? null;
    }
    return input as UnifiedMessage;
  }
  return null;
}

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

export function buildTextMessage(
  channel: string,
  accountId: string,
  userId: string,
  text: string,
  chatType?: "direct" | "group",
): UnifiedMessage {
  return buildMessage({ channel, accountId, userId, text, chatType });
}

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

export function createMediaRef(url: string, fileName?: string, sizeBytes?: number): MediaReference {
  return {
    url,
    kind: detectMediaKind(fileName ?? url),
    mimeType: "application/octet-stream",
    fileName,
    sizeBytes,
  };
}

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

export function extractPlainText(msg: UnifiedMessage): string {
  let text = msg.text;

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

export function parseMediaFromText(text: string): MediaReference[] {
  const media: MediaReference[] = [];
  const seen = new Set<string>();

  const mdImageRe = /!\[([^\]]*)\]\(([^)]+)\)/g;
  for (const m of text.matchAll(mdImageRe)) {
    const url = m[2];
    if (!seen.has(url)) {
      seen.add(url);
      media.push(createMediaRef(url, m[1] || undefined));
    }
  }

  const mediaRe = /^MEDIA:\s*`?([^\n`]+?)`?\s*$/gm;
  for (const m of text.matchAll(mediaRe)) {
    const url = m[1].trim();
    if (!seen.has(url)) {
      seen.add(url);
      media.push(createMediaRef(url));
    }
  }

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

export class MessageParseError extends Error {
  readonly rawInput: string;

  constructor(rawInput: string, reason?: string) {
    super(`消息解析失败: ${reason ?? "无效的格式"}`);
    this.name = "MessageParseError";
    this.rawInput = rawInput;
  }
}
