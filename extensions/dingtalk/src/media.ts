/**
 * 钉钉媒体处理
 *
 * 提供:
 * - uploadMediaDingtalk: 上传媒体到钉钉存储
 * - sendMediaDingtalk: 发送媒体消息
 * - processLocalImagesInMarkdown: 解析并上传本地图片（支持 MEDIA: 前缀）
 * - FileSizeLimitError: 文件大小超限错误
 * - TimeoutError: 下载超时错误
 *
 * API 文档:
 * - 上传媒体: https://open.dingtalk.com/document/orgapp/upload-media-files
 * - 发送图片: https://open.dingtalk.com/document/orgapp/chatbots-send-one-on-one-chat-messages-in-batches
 * - 下载文件: https://open.dingtalk.com/document/orgapp/download-the-file-content-of-the-robot-receiving-message
 */

import { getAccessToken } from "./client.js";
import type { ResolvedDingTalkAccount } from "./types.js";
import * as path from "path";
import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as os from "os";

/**
 * Minimal logger interface for optional logging
 */
interface Logger {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string, err?: unknown) => void;
  debug?: (msg: string) => void;
}

/**
 * Error thrown when file size exceeds the limit for the message type
 */
export class FileSizeLimitError extends Error {
  /** Actual file size in bytes */
  public readonly actualSize: number;
  /** Size limit in bytes for the message type */
  public readonly limitSize: number;
  /** Message type (picture, video, audio, file) */
  public readonly msgType: string;

  constructor(actualSize: number, limitSize: number, msgType: string) {
    super(
      `File size ${actualSize} bytes exceeds limit ${limitSize} bytes for ${msgType}`
    );
    this.name = "FileSizeLimitError";
    this.actualSize = actualSize;
    this.limitSize = limitSize;
    this.msgType = msgType;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FileSizeLimitError);
    }
  }
}

/**
 * Error thrown when download times out
 */
export class TimeoutError extends Error {
  /** Timeout duration in milliseconds */
  public readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Download timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TimeoutError);
    }
  }
}

// ======================= Constants =======================

/** 钉钉 API 基础 URL */
const DINGTALK_API_BASE = "https://api.dingtalk.com";

/** 钉钉旧版 API 基础 URL (用于媒体上传) */
const DINGTALK_OAPI_BASE = "https://oapi.dingtalk.com";

/** HTTP 请求超时时间（毫秒） */
const REQUEST_TIMEOUT = 30000;

/** 媒体上传超时时间（毫秒） */
const UPLOAD_TIMEOUT = 60000;

/** 文件大小限制（按消息类型，字节） */
const FILE_SIZE_LIMITS: Record<string, number> = {
  picture: 100 * 1024 * 1024, // 100MB
  video: 100 * 1024 * 1024,
  audio: 100 * 1024 * 1024,
  file: 100 * 1024 * 1024,
};

/** 下载超时时间（毫秒） */
const DOWNLOAD_TIMEOUT = 120_000;

// ======================= Result Types =======================

/**
 * 媒体上传结果
 */
export interface UploadMediaResult {
  /** 媒体 ID */
  mediaId: string;
  /** 媒体类型 */
  type: "image" | "voice" | "video" | "file";
}

/**
 * 发送媒体参数
 */
export interface SendMediaParams {
  /** 钉钉账号配置（已解析） */
  cfg: ResolvedDingTalkAccount;
  /** 目标 ID（用户 ID 或会话 ID） */
  to: string;
  /** 媒体 URL 或本地路径 */
  mediaUrl: string;
  /** 聊天类型 */
  chatType: "direct" | "group";
  /** 可选的媒体 Buffer */
  mediaBuffer?: Buffer;
  /** 可选的文件名 */
  fileName?: string;
}

/**
 * 发送消息结果
 */
export interface DingtalkSendResult {
  messageId: string;
  conversationId: string;
}

/**
 * 下载后的文件信息
 */
export interface DownloadedFile {
  /** 绝对路径 */
  path: string;
  /** MIME content type */
  contentType: string;
  /** 文件大小（字节） */
  size: number;
  /** 原始文件名 */
  fileName?: string;
}

/**
 * 参数：下载钉钉文件
 */
export interface DownloadDingTalkFileParams {
  /** 下载码 */
  downloadCode: string;
  /** 机器人 code（clientId） */
  robotCode: string;
  /** API 鉴权 token */
  accessToken: string;
  /** 原始文件名（可选） */
  fileName?: string;
  /** 消息类型（用于大小限制） */
  msgType?: MediaMsgType;
  /** 日志 */
  log?: Logger;
  /** 最大文件大小（MB，可选） */
  maxFileSizeMB?: number;
}

// ======================= Helper Functions =======================

/**
 * 检测媒体类型（基于文件名扩展名）
 */
export function detectMediaType(
  fileName: string
): "image" | "voice" | "video" | "file" {
  const ext = path.extname(fileName).toLowerCase();

  if ([".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"].includes(ext)) {
    return "image";
  }

  if ([".mp3", ".wav", ".amr", ".opus", ".ogg"].includes(ext)) {
    return "voice";
  }

  if ([".mp4", ".mov", ".avi", ".mkv"].includes(ext)) {
    return "video";
  }

  return "file";
}

/**
 * 从 Content-Type 检测媒体类型
 */
export function detectMediaTypeFromContentType(
  contentType: string | null
): "image" | "voice" | "video" | "file" {
  if (!contentType) return "file";

  const mime = contentType.split(";")[0].trim().toLowerCase();

  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "voice";
  if (mime.startsWith("video/")) return "video";

  return "file";
}

/**
 * 从 Content-Type 推断文件扩展名
 */
function getExtensionFromContentType(contentType: string | null): string {
  if (!contentType) return "";

  const mime = contentType.split(";")[0].trim().toLowerCase();

  const mimeToExt: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/ogg": ".ogg",
    "audio/amr": ".amr",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/x-msvideo": ".avi",
  };

  return mimeToExt[mime] ?? "";
}

/**
 * 检查是否为本地文件路径
 */
function isLocalPath(urlOrPath: string): boolean {
  if (
    urlOrPath.startsWith("/") ||
    urlOrPath.startsWith("~") ||
    /^[a-zA-Z]:/.test(urlOrPath)
  ) {
    return true;
  }

  try {
    const url = new URL(urlOrPath);
    return url.protocol === "file:";
  } catch {
    return true;
  }
}

// ======================= Inlined Shared Utilities =======================

/**
 * Inlined from @openclaw-china/shared: extract image references from text
 */
function extractImagesFromText(
  text: string,
  options: {
    removeFromText?: boolean;
    checkExists?: boolean;
    existsSync?: (p: string) => boolean;
    parseMarkdownImages?: boolean;
    parseHtmlImages?: boolean;
    parseBarePaths?: boolean;
  }
): {
  images: Array<{
    source: string;
    localPath?: string;
    isLocal?: boolean;
  }>;
} {
  const images: Array<{
    source: string;
    localPath?: string;
    isLocal?: boolean;
  }> = [];
  const seen = new Set<string>();

  const addImage = (source: string, localPath?: string) => {
    if (seen.has(source)) return;
    seen.add(source);

    const isLocal = localPath !== undefined;

    if (options.checkExists && isLocal && localPath && options.existsSync) {
      if (!options.existsSync(localPath)) {
        images.push({ source, isLocal: false });
        return;
      }
    }

    images.push({ source, localPath, isLocal });
  };

  // Markdown images: ![alt](url)
  if (options.parseMarkdownImages !== false) {
    const mdRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let match;
    while ((match = mdRegex.exec(text)) !== null) {
      const src = match[2].trim();
      if (src.startsWith("http://") || src.startsWith("https://")) {
        addImage(src);
      } else if (src.startsWith("MEDIA:")) {
        addImage(src, src.slice(6).trim());
      } else if (src.startsWith("file://")) {
        addImage(src, src.slice(7));
      } else {
        // Local path
        addImage(src, src);
      }
    }
  }

  // Bare paths
  if (options.parseBarePaths) {
    const bareRegex = new RegExp(
      "(?:^|[\\s(])((?:\\/[^\\s)]+|~[^\\s)]+|MEDIA:[^\\s)]+)(?=[\\s)]|$)",
      "gm"
    );
    let bareMatch: RegExpExecArray | null;
    while ((bareMatch = bareRegex.exec(text)) !== null) {
      const src = bareMatch[1].trim();
      if (seen.has(src)) continue;
      if (src.startsWith("MEDIA:")) {
        addImage(src, src.slice(6).trim());
      } else {
        addImage(src, src);
      }
    }
  }

  return { images };
}

/**
 * Inlined from @openclaw-china/shared: safe file cleanup
 */
async function cleanupFileSafe(
  filePath: string | undefined,
  onError?: (err: unknown, filePath: string) => void
): Promise<void> {
  if (!filePath) return;
  try {
    await fsPromises.unlink(filePath);
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === "ENOENT") return;
    onError?.(err, filePath);
  }
}

/**
 * Inlined from @openclaw-china/shared: download to temp file
 */
async function downloadToTempFile(
  url: string,
  options: {
    timeout: number;
    maxSize: number;
    sourceFileName?: string;
    tempPrefix?: string;
    tempDir?: string;
  }
): Promise<{ path: string; contentType: string; size: number }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout);

  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`Download failed: HTTP ${response.status}`);
    }

    const contentType =
      response.headers.get("content-type") ?? "application/octet-stream";

    // Check Content-Length header first (fast path)
    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      const length = parseInt(contentLength, 10);
      if (!isNaN(length) && length > options.maxSize) {
        throw new FileSizeLimitError(length, options.maxSize, "file");
      }
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // Verify size after download (catches cases where Content-Length is absent)
    if (buffer.length > options.maxSize) {
      throw new FileSizeLimitError(buffer.length, options.maxSize, "file");
    }

    const ext = options.sourceFileName
      ? path.extname(options.sourceFileName)
      : "";
    const tempDir = options.tempDir ?? os.tmpdir();
    const prefix = options.tempPrefix ?? "download";
    const tempPath = path.join(tempDir, `${prefix}-${Date.now()}${ext}`);

    await fsPromises.writeFile(tempPath, buffer);

    return { path: tempPath, contentType, size: buffer.length };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new TimeoutError(options.timeout);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================================
// Media Upload & Send
// ============================================================================

/**
 * 上传媒体到钉钉存储
 */
export async function uploadMediaDingtalk(params: {
  cfg: ResolvedDingTalkAccount;
  media: Buffer;
  fileName: string;
  mediaType: "image" | "voice" | "video" | "file";
}): Promise<UploadMediaResult> {
  const { cfg, media, fileName, mediaType } = params;

  if (!cfg.clientId || !cfg.clientSecret) {
    throw new Error(
      "DingTalk credentials not configured (clientId, clientSecret required)"
    );
  }

  const accessToken = await getAccessToken(cfg);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT);

  try {
    const formData = new FormData();
    const blob = new Blob([media], { type: "application/octet-stream" });
    formData.append("media", blob, fileName);
    formData.append("type", mediaType);

    const response = await fetch(
      `${DINGTALK_OAPI_BASE}/media/upload?access_token=${accessToken}&type=${mediaType}`,
      {
        method: "POST",
        body: formData,
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `DingTalk media upload failed: HTTP ${response.status} - ${errorText}`
      );
    }

    const data = (await response.json()) as {
      errcode?: number;
      errmsg?: string;
      media_id?: string;
      type?: string;
    };

    if (data.errcode && data.errcode !== 0) {
      throw new Error(
        `DingTalk media upload failed: ${data.errmsg ?? "unknown error"} (code: ${data.errcode})`
      );
    }

    if (!data.media_id) {
      throw new Error("DingTalk media upload failed: no media_id returned");
    }

    return {
      mediaId: data.media_id,
      type: mediaType,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `DingTalk media upload timed out after ${UPLOAD_TIMEOUT}ms`
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 发送媒体消息到钉钉
 */
export async function sendMediaDingtalk(
  params: SendMediaParams
): Promise<DingtalkSendResult> {
  const { cfg, to, mediaUrl, chatType, mediaBuffer, fileName } = params;

  if (!cfg.clientId || !cfg.clientSecret) {
    throw new Error(
      "DingTalk credentials not configured (clientId, clientSecret required)"
    );
  }

  let buffer: Buffer;
  let name: string;
  let detectedMediaType: "image" | "voice" | "video" | "file" | undefined;

  if (mediaBuffer) {
    buffer = mediaBuffer;
    name = fileName ?? "file";
  } else if (mediaUrl) {
    if (isLocalPath(mediaUrl)) {
      const filePath = mediaUrl.startsWith("~")
        ? mediaUrl.replace("~", process.env.HOME ?? "")
        : mediaUrl.replace("file://", "");

      if (!fs.existsSync(filePath)) {
        throw new Error(`Local file not found: ${filePath}`);
      }
      buffer = fs.readFileSync(filePath);
      name = fileName ?? path.basename(filePath);
    } else {
      // Remote URL
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      try {
        const response = await fetch(mediaUrl, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(
            `Failed to fetch media from URL: HTTP ${response.status}`
          );
        }

        const contentType = response.headers.get("content-type");
        detectedMediaType = detectMediaTypeFromContentType(contentType);

        buffer = Buffer.from(await response.arrayBuffer());

        let baseName =
          fileName ??
          (path.basename(new URL(mediaUrl).pathname) || "file");

        if (!path.extname(baseName) && contentType) {
          const ext = getExtensionFromContentType(contentType);
          if (ext) {
            baseName = baseName + ext;
          }
        }
        name = baseName;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          throw new Error(
            `Media download timed out after ${REQUEST_TIMEOUT}ms`
          );
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }
    }
  } else {
    throw new Error("Either mediaUrl or mediaBuffer must be provided");
  }

  const mediaType = detectedMediaType ?? detectMediaType(name);

  // Upload media
  const uploadResult = await uploadMediaDingtalk({
    cfg,
    media: buffer,
    fileName: name,
    mediaType,
  });

  // Get access token
  const accessToken = await getAccessToken(cfg);

  if (chatType === "direct") {
    return sendDirectMediaMessage({
      cfg,
      to,
      mediaId: uploadResult.mediaId,
      mediaType,
      accessToken,
      fileName: name,
    });
  } else {
    return sendGroupMediaMessage({
      cfg,
      to,
      mediaId: uploadResult.mediaId,
      mediaType,
      accessToken,
      fileName: name,
    });
  }
}

/**
 * 处理 Markdown 中的本地图片路径（含 MEDIA: 前缀），并替换为 media_id
 */
export async function processLocalImagesInMarkdown(params: {
  text: string;
  cfg: ResolvedDingTalkAccount;
  log?: Logger;
  cache?: Map<string, string>;
}): Promise<string> {
  const { text, cfg, log, cache } = params;
  const mediaCache = cache ?? new Map<string, string>();

  const { images } = extractImagesFromText(text, {
    removeFromText: false,
    checkExists: true,
    existsSync: (p: string) => {
      const exists = fs.existsSync(p);
      if (!exists) {
        log?.warn?.(`[dingtalk] local image not found: ${p}`);
      }
      return exists;
    },
    parseMarkdownImages: true,
    parseHtmlImages: false,
    parseBarePaths: true,
  });

  const localImages = images.filter((img) => img.isLocal && img.localPath);

  if (localImages.length === 0) {
    return text;
  }

  const getMediaId = async (localPath: string): Promise<string> => {
    const cached = mediaCache.get(localPath);
    if (cached) return cached;
    const fileBuffer = await fsPromises.readFile(localPath);
    const fileName = path.basename(localPath);
    const upload = await uploadMediaDingtalk({
      cfg,
      media: fileBuffer,
      fileName,
      mediaType: "image",
    });
    mediaCache.set(localPath, upload.mediaId);
    return upload.mediaId;
  };

  let result = text;

  for (const img of localImages) {
    if (!img.localPath) continue;

    try {
      const mediaId = await getMediaId(img.localPath);

      // Replace Markdown image syntax: ![alt](source)
      const escapedSource = img.source.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );
      const mdPattern = new RegExp(
        `!\\[([^\\]]*)\\]\\(${escapedSource}\\)`,
        "g"
      );
      result = result.replace(mdPattern, `![$1](${mediaId})`);

      // Replace bare paths (non-Markdown format)
      if (result.includes(img.source)) {
        result = result.split(img.source).join(`![](${mediaId})`);
      }
    } catch (err) {
      log?.warn?.(
        `[dingtalk] failed to upload image ${img.localPath}: ${err}`
      );
    }
  }

  return result;
}

// ======================= Internal: Message Building =======================

function getMsgKeyForMediaType(
  mediaType: "image" | "voice" | "video" | "file"
): string {
  switch (mediaType) {
    case "image":
      return "sampleImageMsg";
    case "voice":
      return "sampleAudio";
    case "video":
      return "sampleVideo";
    case "file":
      return "sampleFile";
    default:
      return "sampleFile";
  }
}

function buildMediaMsgParam(
  mediaId: string,
  mediaType: "image" | "voice" | "video" | "file",
  fileName?: string
): string {
  switch (mediaType) {
    case "image":
      return JSON.stringify({ photoURL: mediaId });
    case "voice":
      return JSON.stringify({ mediaId, duration: "1000" });
    case "video":
      return JSON.stringify({
        videoMediaId: mediaId,
        videoType: "mp4",
        duration: "1000",
      });
    case "file":
      return JSON.stringify({
        mediaId,
        fileName: fileName ?? "file",
        fileType: "file",
      });
    default:
      return JSON.stringify({ mediaId });
  }
}

async function sendDirectMediaMessage(params: {
  cfg: ResolvedDingTalkAccount;
  to: string;
  mediaId: string;
  mediaType: "image" | "voice" | "video" | "file";
  accessToken: string;
  fileName?: string;
}): Promise<DingtalkSendResult> {
  const { cfg, to, mediaId, mediaType, accessToken, fileName } = params;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(
      `${DINGTALK_API_BASE}/v1.0/robot/oToMessages/batchSend`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-acs-dingtalk-access-token": accessToken,
        },
        body: JSON.stringify({
          robotCode: cfg.clientId,
          userIds: [to],
          msgKey: getMsgKeyForMediaType(mediaType),
          msgParam: buildMediaMsgParam(mediaId, mediaType, fileName),
        }),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `DingTalk direct media send failed: HTTP ${response.status} - ${errorText}`
      );
    }

    const data = (await response.json()) as {
      processQueryKey?: string;
    };

    return {
      messageId: data.processQueryKey ?? `dm_media_${Date.now()}`,
      conversationId: to,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `DingTalk direct media send timed out after ${REQUEST_TIMEOUT}ms`
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function sendGroupMediaMessage(params: {
  cfg: ResolvedDingTalkAccount;
  to: string;
  mediaId: string;
  mediaType: "image" | "voice" | "video" | "file";
  accessToken: string;
  fileName?: string;
}): Promise<DingtalkSendResult> {
  const { cfg, to, mediaId, mediaType, accessToken, fileName } = params;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(
      `${DINGTALK_API_BASE}/v1.0/robot/groupMessages/send`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-acs-dingtalk-access-token": accessToken,
        },
        body: JSON.stringify({
          robotCode: cfg.clientId,
          openConversationId: to,
          msgKey: getMsgKeyForMediaType(mediaType),
          msgParam: buildMediaMsgParam(mediaId, mediaType, fileName),
        }),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `DingTalk group media send failed: HTTP ${response.status} - ${errorText}`
      );
    }

    const data = (await response.json()) as {
      processQueryKey?: string;
    };

    return {
      messageId: data.processQueryKey ?? `gm_media_${Date.now()}`,
      conversationId: to,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `DingTalk group media send timed out after ${REQUEST_TIMEOUT}ms`
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================================
// Media Receiving
// ============================================================================

export type MediaMsgType = "picture" | "video" | "audio" | "file";

export interface ExtractedFileInfo {
  downloadCode: string;
  msgType: MediaMsgType;
  fileName?: string;
  fileSize?: number;
  duration?: number;
  recognition?: string;
}

interface MediaContent {
  downloadCode?: string;
  pictureDownloadCode?: string;
  videoDownloadCode?: string;
  duration?: number;
  recognition?: string;
  fileName?: string;
  fileSize?: number;
}

function parseContent(content: unknown): MediaContent | null {
  if (!content) return null;

  if (typeof content === "string") {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as MediaContent;
      }
      return null;
    } catch {
      return null;
    }
  }

  if (typeof content === "object" && !Array.isArray(content)) {
    return content as MediaContent;
  }

  return null;
}

function extractDownloadCode(
  content: MediaContent,
  msgType: MediaMsgType
): string | null {
  if (content.downloadCode) {
    return content.downloadCode;
  }

  if (msgType === "picture" && content.pictureDownloadCode) {
    return content.pictureDownloadCode;
  }

  if (msgType === "video" && content.videoDownloadCode) {
    return content.videoDownloadCode;
  }

  return null;
}

/**
 * 从消息中提取文件信息
 */
export function extractFileFromMessage(data: unknown): ExtractedFileInfo | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const msg = data as Record<string, unknown>;

  const msgtype = msg.msgtype;
  if (typeof msgtype !== "string") {
    return null;
  }

  const supportedTypes: MediaMsgType[] = ["picture", "video", "audio", "file"];
  if (!supportedTypes.includes(msgtype as MediaMsgType)) {
    return null;
  }

  const msgType = msgtype as MediaMsgType;

  const content = parseContent(msg.content);
  if (!content) {
    return null;
  }

  const downloadCode = extractDownloadCode(content, msgType);
  if (!downloadCode) {
    return null;
  }

  const result: ExtractedFileInfo = {
    downloadCode,
    msgType,
  };

  switch (msgType) {
    case "picture":
      break;
    case "video":
      if (typeof content.duration === "number") {
        result.duration = content.duration;
      }
      break;
    case "audio":
      if (typeof content.duration === "number") {
        result.duration = content.duration;
      }
      if (typeof content.recognition === "string") {
        result.recognition = content.recognition;
      }
      break;
    case "file":
      if (typeof content.fileName === "string") {
        result.fileName = content.fileName;
      }
      if (typeof content.fileSize === "number") {
        result.fileSize = content.fileSize;
      }
      break;
  }

  return result;
}

// ============================================================================
// Rich Text Parsing
// ============================================================================

export interface RichTextElement {
  type: "text" | "picture" | "at";
  text?: string;
  downloadCode?: string;
  pictureDownloadCode?: string;
  userId?: string;
}

export interface RichTextParseResult {
  textParts: string[];
  imageCodes: string[];
  mentions: string[];
  elements: RichTextElement[];
}

function parseRichText(richText: unknown): RichTextElement[] | null {
  if (!richText) return null;

  if (typeof richText === "string") {
    try {
      const parsed = JSON.parse(richText);
      if (Array.isArray(parsed)) {
        return parsed as RichTextElement[];
      }
      return null;
    } catch {
      return null;
    }
  }

  if (Array.isArray(richText)) {
    return richText as RichTextElement[];
  }

  return null;
}

function parseRichTextContent(
  content: unknown
): Record<string, unknown> | null {
  if (!content) return null;

  if (typeof content === "string") {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }

  if (typeof content === "object" && !Array.isArray(content)) {
    return content as Record<string, unknown>;
  }

  return null;
}

/**
 * 解析钉钉富文本消息
 */
export function parseRichTextMessage(data: unknown): RichTextParseResult | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const msg = data as Record<string, unknown>;

  if (msg.msgtype !== "richText") {
    return null;
  }

  const contentObj = parseRichTextContent(msg.content);
  if (!contentObj) {
    return null;
  }

  const richTextElements = parseRichText(contentObj.richText);
  if (!richTextElements || richTextElements.length === 0) {
    return null;
  }

  const textParts: string[] = [];
  const imageCodes: string[] = [];
  const mentions: string[] = [];
  const orderedElements: RichTextElement[] = [];

  for (const element of richTextElements) {
    if (!element || typeof element !== "object") {
      continue;
    }

    const elementType = element.type;
    const hasText = typeof element.text === "string";

    // Some DingTalk richText elements omit "type" for text nodes.
    if (!elementType && hasText) {
      textParts.push(element.text as string);
      orderedElements.push({ type: "text", text: element.text as string });
      continue;
    }

    switch (elementType) {
      case "text":
        if (hasText) {
          textParts.push(element.text as string);
          orderedElements.push({ type: "text", text: element.text as string });
        }
        break;

      case "picture": {
        const code = element.downloadCode || element.pictureDownloadCode;
        if (typeof code === "string" && code) {
          imageCodes.push(code);
          orderedElements.push({ type: "picture", downloadCode: code });
        }
        break;
      }

      case "at":
        if (typeof element.userId === "string" && element.userId) {
          mentions.push(element.userId);
          orderedElements.push({ type: "at", userId: element.userId });
        }
        break;
    }
  }

  return {
    textParts,
    imageCodes,
    mentions,
    elements: orderedElements,
  };
}

// ============================================================================
// File Download
// ============================================================================

/**
 * 从钉钉下载文件
 */
export async function downloadDingTalkFile(
  params: DownloadDingTalkFileParams
): Promise<DownloadedFile> {
  const { downloadCode, robotCode, accessToken, fileName, log, maxFileSizeMB } =
    params;
  const msgType = params.msgType ?? "file";

  const defaultLimit = FILE_SIZE_LIMITS[msgType] ?? FILE_SIZE_LIMITS.file;
  const sizeLimit = maxFileSizeMB
    ? maxFileSizeMB * 1024 * 1024
    : defaultLimit;

  // Step 1: Get download URL
  const apiController = new AbortController();
  const apiTimeoutId = setTimeout(() => apiController.abort(), REQUEST_TIMEOUT);

  let downloadUrl: string;

  try {
    log?.debug?.(
      `Getting download URL for code: ${downloadCode.slice(0, 10)}...`
    );

    const apiResponse = await fetch(
      `${DINGTALK_API_BASE}/v1.0/robot/messageFiles/download`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-acs-dingtalk-access-token": accessToken,
        },
        body: JSON.stringify({
          downloadCode,
          robotCode,
        }),
        signal: apiController.signal,
      }
    );

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      throw new Error(
        `DingTalk API error: HTTP ${apiResponse.status} - ${errorText}`
      );
    }

    const apiData = (await apiResponse.json()) as {
      downloadUrl?: string;
    };

    if (!apiData.downloadUrl) {
      throw new Error("DingTalk API returned no downloadUrl");
    }

    downloadUrl = apiData.downloadUrl;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `DingTalk API request timed out after ${REQUEST_TIMEOUT}ms`
      );
    }
    throw err;
  } finally {
    clearTimeout(apiTimeoutId);
  }

  // Step 2: Download the file
  log?.debug?.(`Got download URL, starting download...`);
  try {
    const downloaded = await downloadToTempFile(downloadUrl, {
      timeout: DOWNLOAD_TIMEOUT,
      maxSize: sizeLimit,
      sourceFileName: fileName,
      tempPrefix: "dingtalk-file",
      tempDir: os.tmpdir(),
    });

    log?.debug?.(
      `File saved to: ${downloaded.path} (${downloaded.size} bytes)`
    );

    return {
      path: downloaded.path,
      contentType: downloaded.contentType,
      size: downloaded.size,
      fileName,
    };
  } catch (err) {
    if (err instanceof FileSizeLimitError) {
      throw err;
    }
    if (err instanceof TimeoutError) {
      throw err;
    }
    throw err;
  }
}

export interface DownloadRichTextImagesParams {
  imageCodes: string[];
  robotCode: string;
  accessToken: string;
  log?: Logger;
  maxFileSizeMB?: number;
}

/**
 * 下载富文本消息中的所有图片
 */
export async function downloadRichTextImages(
  params: DownloadRichTextImagesParams
): Promise<DownloadedFile[]> {
  const { imageCodes, robotCode, accessToken, log, maxFileSizeMB } = params;

  const results: DownloadedFile[] = [];
  const total = imageCodes.length;

  for (let i = 0; i < total; i++) {
    const code = imageCodes[i];
    const index = i + 1;

    log?.info?.(`downloading image ${index}/${total}`);

    try {
      const file = await downloadDingTalkFile({
        downloadCode: code,
        robotCode,
        accessToken,
        msgType: "picture",
        log,
        maxFileSizeMB,
      });

      results.push(file);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log?.warn?.(`Failed to download image ${index}/${total}: ${errorMessage}`);
    }
  }

  return results;
}

/**
 * 清理临时文件
 */
export async function cleanupFile(
  filePath?: string,
  log?: Logger
): Promise<void> {
  await cleanupFileSafe(filePath, (err, targetPath) => {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log?.debug?.(`Failed to cleanup file ${targetPath}: ${errorMessage}`);
  });
}
