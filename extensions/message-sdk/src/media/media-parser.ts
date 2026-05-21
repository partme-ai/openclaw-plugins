/**
 * 媒体解析器 — Markdown/HTML/MEDIA:指令/裸露路径的媒体提取引擎
 *
 * 来源：openclaw-china packages/shared/src/media/media-parser.ts (723行)
 * 适配：独立 TypeScript 模块，不依赖 openclaw-china/shared
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================================
// 类型
// ============================================================================

export type MediaType = "image" | "audio" | "video" | "file";
export type MediaSourceKind = "markdown" | "markdown-linked" | "html" | "bare";

export interface ExtractedMedia {
  source: string;
  localPath?: string;
  type: MediaType;
  isLocal: boolean;
  isHttp: boolean;
  fileName?: string;
  sourceKind?: MediaSourceKind;
}

export interface MediaParseResult {
  text: string;
  images: ExtractedMedia[];
  files: ExtractedMedia[];
  all: ExtractedMedia[];
}

export interface MediaParseOptions {
  removeFromText?: boolean;
  checkExists?: boolean;
  existsSync?: (path: string) => boolean;
  parseMediaLines?: boolean;
  parseMarkdownImages?: boolean;
  parseHtmlImages?: boolean;
  parseBarePaths?: boolean;
  parseMarkdownLinks?: boolean;
}

// ============================================================================
// 扩展名集合
// ============================================================================

export const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "tif", "heic", "heif", "svg", "ico"]);
export const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "m4a", "amr", "flac", "aac", "wma"]);
export const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "avi", "mkv", "webm", "flv", "wmv", "m4v"]);

export const NON_IMAGE_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx", "txt", "md", "rtf", "odt", "ods",
  "zip", "rar", "7z", "tar", "gz", "tgz", "bz2",
  "json", "xml", "yaml", "yml",
  ...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS,
]);

// ============================================================================
// 正则
// ============================================================================

const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const MARKDOWN_LINKED_IMAGE_RE = /\[!\[([^\]]*)\]\(([^)]+)\)\]\(([^)]+)\)/g;
const HTML_IMAGE_RE = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi;
const MARKDOWN_LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;

const NON_IMAGE_EXT_PATTERN = Array.from(NON_IMAGE_EXTENSIONS).join("|");
const BARE_IMAGE_PATH_RE = new RegExp(String.raw`\x60?((?:\/(?:tmp|var|private|Users|home|root)\/[^\s\x60'",)]+|[A-Za-z]:[\\/][^\s\x60'",)]+)\.(?:png|jpg|jpeg|gif|bmp|webp|svg|ico))\x60?`, "gi");
const BARE_FILE_PATH_RE = new RegExp(String.raw`\x60?((?:\/(?:tmp|var|private|Users|home|root)\/[^\s'",)]+|[A-Za-z]:[\\/][^\s'",)]+)\.(?:${NON_IMAGE_EXT_PATTERN}))\x60?`, "gi");

// ============================================================================
// 路径工具
// ============================================================================

export function isHttpUrl(value: string): boolean { return /^https?:\/\//i.test(value); }
export function isFileUrl(value: string): boolean { return /^file:\/\//i.test(value); }

export function isLocalReference(raw: string): boolean {
  if (isHttpUrl(raw)) return false;
  return raw.startsWith("file://") || raw.startsWith("MEDIA:") || raw.startsWith("attachment://") || raw.startsWith("/") || raw.startsWith("~") || /^[a-zA-Z]:[\\/]/.test(raw);
}

export function normalizeLocalPath(raw: string): string {
  let p = raw.trim();
  if (isFileUrl(p)) { try { return fileURLToPath(p); } catch { p = p.replace(/^file:\/\/\/?/i, ""); } }
  if (p.startsWith("MEDIA:")) p = p.replace(/^MEDIA:/i, "");
  else if (p.startsWith("attachment://")) p = p.replace(/^attachment:\/\//i, "");
  p = p.replace(/\\ /g, " ");
  try { p = decodeURIComponent(p); } catch { /* ignore */ }
  if (p.startsWith("~/") || p === "~") p = path.join(os.homedir(), p.slice(1));
  if (!path.isAbsolute(p)) p = path.resolve(process.cwd(), p);
  return p;
}

export function stripTitleFromUrl(value: string): string {
  const m = value.trim().match(/^(\S+)\s+["'][^"']*["']\s*$/);
  return m ? m[1] : value.trim();
}

export function getExtension(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return ext.startsWith(".") ? ext.slice(1) : ext;
}

export function isImagePath(filePath: string): boolean { return IMAGE_EXTENSIONS.has(getExtension(filePath)); }
export function isNonImageFilePath(filePath: string): boolean { return NON_IMAGE_EXTENSIONS.has(getExtension(filePath)); }

export function detectMediaTypeFromPath(filePath: string): MediaType {
  const ext = getExtension(filePath);
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  return "file";
}

// ============================================================================
// 核心提取
// ============================================================================

function createExtractedMedia(source: string, sourceKind: MediaSourceKind, options?: MediaParseOptions): ExtractedMedia {
  const isHttp = isHttpUrl(source);
  const isLocal = !isHttp && isLocalReference(source);
  const clean = stripTitleFromUrl(source);
  let localPath: string | undefined;
  let fileName: string | undefined;
  if (isLocal) { localPath = normalizeLocalPath(clean); fileName = path.basename(localPath); }
  else if (isHttp) { try { fileName = path.basename(new URL(clean).pathname) || undefined; } catch { /* ignore */ } }
  return { source: clean, localPath, type: detectMediaTypeFromPath(fileName || clean), isLocal, isHttp, fileName, sourceKind };
}

export function extractMediaFromText(text: string, options: MediaParseOptions = {}): MediaParseResult {
  const { removeFromText = true, checkExists = false, existsSync, parseMediaLines = false, parseMarkdownImages = true, parseHtmlImages = true, parseBarePaths = true, parseMarkdownLinks = true } = options;
  const images: ExtractedMedia[] = [];
  const files: ExtractedMedia[] = [];
  const seen = new Set<string>();
  let result = text;

  const addMedia = (m: ExtractedMedia): boolean => {
    const key = m.localPath || m.source;
    if (seen.has(key)) return false;
    if (checkExists && m.isLocal && m.localPath) {
      const exists = existsSync ? existsSync(m.localPath) : fs.existsSync(m.localPath);
      if (!exists) return false;
    }
    seen.add(key);
    if (m.type === "image") images.push(m); else files.push(m);
    return true;
  };

  type Replacement = { start: number; end: number; replacement: string };
  const replacements: Replacement[] = [];

  const applyReplacements = () => {
    if (replacements.length === 0) return;
    replacements.sort((a, b) => b.start - a.start);
    for (const { start, end, replacement } of replacements) result = result.slice(0, start) + replacement + result.slice(end);
    replacements.length = 0;
  };

  // 0. MEDIA: 行指令
  if (parseMediaLines) {
    const lines = result.split("\n");
    const kept: string[] = [];
    for (const line of lines) {
      const ts = line.trimStart();
      if (!ts.startsWith("MEDIA:")) { kept.push(line); continue; }
      const payload = ts.slice(6).trim();
      if (!payload) { kept.push(line); continue; }
      for (const c of payload.split(/\s+/).filter(Boolean)) {
        const cleaned = stripTitleFromUrl(c.replace(/^[`"'[{(<]+/, "").replace(/[`"'\])}>.,;]+$/, ""));
        if (!cleaned || (!isHttpUrl(cleaned) && !isLocalReference(cleaned))) continue;
        addMedia(createExtractedMedia(cleaned, "bare", options));
      }
      if (!removeFromText) kept.push(line);
    }
    if (removeFromText) result = kept.join("\n");
  }

  // 1. Markdown linked images
  if (parseMarkdownImages) {
    for (const m of text.matchAll(MARKDOWN_LINKED_IMAGE_RE)) {
      const media = createExtractedMedia(m[2], "markdown", options);
      if (media.type === "image" && addMedia(media) && removeFromText && m.index !== undefined) {
        replacements.push({ start: m.index, end: m.index + m[0].length, replacement: "" });
      }
    }
    applyReplacements();
  }

  // 2. Markdown images
  if (parseMarkdownImages) {
    for (const m of result.matchAll(MARKDOWN_IMAGE_RE)) {
      const media = createExtractedMedia(m[2], "markdown", options);
      if (media.type === "image" && addMedia(media) && removeFromText && m.index !== undefined) {
        replacements.push({ start: m.index, end: m.index + m[0].length, replacement: "" });
      }
    }
    applyReplacements();
  }

  // 3. HTML img
  if (parseHtmlImages) {
    for (const m of result.matchAll(HTML_IMAGE_RE)) {
      const src = m[1] || m[2] || m[3];
      if (src) {
        const media = createExtractedMedia(src, "html", options);
        if (media.type === "image" && addMedia(media) && removeFromText && m.index !== undefined) {
          replacements.push({ start: m.index, end: m.index + m[0].length, replacement: "" });
        }
      }
    }
    applyReplacements();
  }

  // 4. Markdown links (files)
  if (parseMarkdownLinks) {
    MARKDOWN_LINK_RE.lastIndex = 0;
    for (const m of result.matchAll(MARKDOWN_LINK_RE)) {
      const idx = m.index ?? 0;
      if (idx > 0 && result[idx - 1] === "!") continue;
      if (!isLocalReference(m[2])) continue;
      const media = createExtractedMedia(m[2], "markdown", options);
      if (media.type !== "image" && isNonImageFilePath(media.localPath || m[2]) && addMedia(media) && removeFromText && m.index !== undefined) {
        replacements.push({ start: m.index, end: m.index + m[0].length, replacement: `[文件: ${media.fileName || path.basename(m[2])}]` });
      }
    }
    applyReplacements();
  }

  // 5. Bare image paths
  if (parseBarePaths && parseMarkdownImages) {
    BARE_IMAGE_PATH_RE.lastIndex = 0;
    for (const m of [...result.matchAll(BARE_IMAGE_PATH_RE)].filter((m) => !result.slice(Math.max(0, (m.index ?? 0) - 10), m.index ?? 0).includes("]("))) {
      const media = createExtractedMedia(m[1], "bare", options);
      if (media.type === "image" && addMedia(media) && removeFromText && m.index !== undefined) {
        replacements.push({ start: m.index, end: m.index + m[0].length, replacement: "" });
      }
    }
    applyReplacements();
  }

  // 6. Bare file paths
  if (parseBarePaths && parseMarkdownLinks) {
    BARE_FILE_PATH_RE.lastIndex = 0;
    for (const m of result.matchAll(BARE_FILE_PATH_RE)) {
      const media = createExtractedMedia(m[1], "bare", options);
      if (media.type !== "image" && addMedia(media) && removeFromText && m.index !== undefined) {
        replacements.push({ start: m.index, end: m.index + m[0].length, replacement: `[文件: ${media.fileName || path.basename(m[1])}]` });
      }
    }
    applyReplacements();
  }

  if (removeFromText) result = result.replace(/\n{3,}/g, "\n\n").trim();
  return { text: result, images, files, all: [...images, ...files] };
}

export function extractImagesFromText(text: string, options: Omit<MediaParseOptions, "parseMarkdownLinks"> = {}): { text: string; images: ExtractedMedia[] } {
  const r = extractMediaFromText(text, { ...options, parseMarkdownLinks: false });
  return { text: r.text, images: r.images };
}

export function extractFilesFromText(text: string, options: Omit<MediaParseOptions, "parseMarkdownImages" | "parseHtmlImages"> = {}): { text: string; files: ExtractedMedia[] } {
  const r = extractMediaFromText(text, { ...options, parseMarkdownImages: false, parseHtmlImages: false });
  return { text: r.text, files: r.files };
}
