/**
 * Media handling for TEMPLATE_NAME channel.
 *
 * Provides:
 * - Media upload to platform storage
 * - Media download from platform API
 * - Media type detection (MIME + extension)
 * - File size validation with structured errors
 * - Inbound media extraction from raw messages
 *
 * Pattern borrowed from openclaw-china's dingtalk media module.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { getRuntime } from "./runtime.js";

// ============================================================================
// Error types
// ============================================================================

/** File size exceeds platform limit */
export class FileSizeLimitError extends Error {
  readonly actualSize: number;
  readonly limitSize: number;
  readonly mediaType: string;

  constructor(actualSize: number, limitSize: number, mediaType: string) {
    super(`File size ${actualSize} bytes exceeds limit ${limitSize} bytes for ${mediaType}`);
    this.name = "FileSizeLimitError";
    this.actualSize = actualSize;
    this.limitSize = limitSize;
    this.mediaType = mediaType;
  }
}

/** Download or upload timeout */
export class MediaTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Media operation timed out after ${timeoutMs}ms`);
    this.name = "MediaTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

// ============================================================================
// Media type detection
// ============================================================================

type MediaType = "image" | "voice" | "video" | "file";

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "amr", "ogg", "m4a", "aac", "opus"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "avi", "mkv", "webm"]);

const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml",
  mp3: "audio/mpeg", wav: "audio/wav", amr: "audio/amr", ogg: "audio/ogg",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  pdf: "application/pdf", zip: "application/zip", txt: "text/plain",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Detect media type from filename extension */
export function detectMediaType(fileName: string): MediaType {
  const ext = path.extname(fileName).toLowerCase().slice(1);
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (AUDIO_EXTENSIONS.has(ext)) return "voice";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  return "file";
}

/** Detect media type from MIME content-type header */
export function detectMediaTypeFromContentType(contentType: string | null): MediaType {
  if (!contentType) return "file";
  const mime = contentType.split(";")[0].trim().toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "voice";
  if (mime.startsWith("video/")) return "video";
  return "file";
}

/** Get MIME type from filename extension */
export function getMimeType(fileName: string): string | undefined {
  const ext = path.extname(fileName).toLowerCase().slice(1);
  return EXT_TO_MIME[ext];
}

// ============================================================================
// Media download
// ============================================================================

export interface DownloadedMedia {
  buffer: Buffer;
  contentType: string;
  fileName: string;
  size: number;
}

const DOWNLOAD_TIMEOUT = 60_000;

/** Download media from a remote URL */
export async function downloadMedia(url: string, maxBytes?: number): Promise<DownloadedMedia> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    if (maxBytes && buffer.length > maxBytes) {
      throw new FileSizeLimitError(buffer.length, maxBytes, "file");
    }

    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "application/octet-stream";
    let fileName = "download";
    try { fileName = path.basename(new URL(url).pathname) || "download"; } catch { /* ignore */ }

    return { buffer, contentType, fileName, size: buffer.length };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new MediaTimeoutError(DOWNLOAD_TIMEOUT);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================================
// Local file reading
// ============================================================================

/** Read a local file with size validation */
export async function readLocalMedia(filePath: string, maxBytes?: number): Promise<DownloadedMedia> {
  // Expand ~ to home directory
  const resolved = filePath.startsWith("~")
    ? path.join(process.env.HOME ?? "/root", filePath.slice(1))
    : filePath;

  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }

  const stat = fs.statSync(resolved);
  if (maxBytes && stat.size > maxBytes) {
    throw new FileSizeLimitError(stat.size, maxBytes, "file");
  }

  const buffer = fs.readFileSync(resolved);
  const fileName = path.basename(resolved);
  const contentType = getMimeType(fileName) ?? "application/octet-stream";

  return { buffer, contentType, fileName, size: buffer.length };
}

// ============================================================================
// Unified media loading
// ============================================================================

/** Load media from URL or local path, auto-detecting source type */
export async function loadMedia(source: string, maxBytes?: number): Promise<DownloadedMedia> {
  if (/^https?:\/\//i.test(source)) {
    return downloadMedia(source, maxBytes);
  }
  return readLocalMedia(source, maxBytes);
}

// ============================================================================
// Inbound media extraction (override per channel)
// ============================================================================

/**
 * Extract file information from a raw inbound message.
 * Override this per channel to match the platform's message format.
 */
export function extractInboundMedia(_rawMessage: unknown): {
  downloadUrl?: string;
  mediaType?: MediaType;
  fileName?: string;
  fileSize?: number;
} | null {
  // Default: no extraction. Override per channel.
  return null;
}
