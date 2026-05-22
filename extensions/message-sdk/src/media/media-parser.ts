/**
 * 媒体解析器 — Markdown/HTML/MEDIA:指令/裸露路径的媒体提取引擎
 *
 * 来源：openclaw-china packages/shared/src/media/media-parser.ts (723行)
 * 适配：独立 TypeScript 模块，不依赖 openclaw-china/shared
 *
 * 该模块只负责“识别文本中的媒体引用并结构化输出”，不读取文件内容、
 * 不下载远程资源，也不做路径安全授权。真实 I/O 由 media-io/path-guard 处理。
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================================
// 类型
// ============================================================================

/**
 * MediaType 是 media 模块的公开类型别名。
 *
 * 该类型用于收窄调用边界，确保不同通道插件复用同一套 SDK 契约。
 */
export type MediaType = "image" | "audio" | "video" | "file";
/**
 * MediaSourceKind 是 media 模块的公开类型别名。
 *
 * 该类型用于收窄调用边界，确保不同通道插件复用同一套 SDK 契约。
 */
export type MediaSourceKind = "markdown" | "markdown-linked" | "html" | "bare";

/**
 * ExtractedMedia 描述 media 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface ExtractedMedia {
  source: string;
  localPath?: string;
  type: MediaType;
  isLocal: boolean;
  isHttp: boolean;
  fileName?: string;
  sourceKind?: MediaSourceKind;
}

/**
 * MediaParseResult 描述 media 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface MediaParseResult {
  text: string;
  images: ExtractedMedia[];
  files: ExtractedMedia[];
  all: ExtractedMedia[];
}

/**
 * MediaParseOptions 描述 media 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
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

/**
 * IMAGE_EXTENSIONS 是 media 模块对外共享的常量或默认实现。
 *
 * 修改该值会影响多个通道插件的默认行为，变更前应同步更新相关测试与文档。
 */
export const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "tif", "heic", "heif", "svg", "ico"]);
/**
 * AUDIO_EXTENSIONS 是 media 模块对外共享的常量或默认实现。
 *
 * 修改该值会影响多个通道插件的默认行为，变更前应同步更新相关测试与文档。
 */
export const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "m4a", "amr", "flac", "aac", "wma"]);
/**
 * VIDEO_EXTENSIONS 是 media 模块对外共享的常量或默认实现。
 *
 * 修改该值会影响多个通道插件的默认行为，变更前应同步更新相关测试与文档。
 */
export const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "avi", "mkv", "webm", "flv", "wmv", "m4v"]);

/**
 * NON_IMAGE_EXTENSIONS 是 media 模块对外共享的常量或默认实现。
 *
 * 修改该值会影响多个通道插件的默认行为，变更前应同步更新相关测试与文档。
 */
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

/**
 * 判断字符串是否是 HTTP(S) URL。
 *
 * @param value - 待判断的原始字符串。
 * @returns `true` 表示可按远程媒体 URL 处理。
 */
export function isHttpUrl(value: string): boolean { return /^https?:\/\//i.test(value); }
/**
 * 判断字符串是否是 file:// URL。
 *
 * @param value - 待判断的原始字符串。
 * @returns `true` 表示后续需要转换为本地文件系统路径。
 */
export function isFileUrl(value: string): boolean { return /^file:\/\//i.test(value); }

/**
 * 判断一段文本是否可作为本地或附件媒体引用。
 *
 * @param raw - 原始路径、MEDIA 指令 payload 或 attachment URL。
 * @returns `true` 表示可以尝试归一化成本地路径。
 */
export function isLocalReference(raw: string): boolean {
  if (isHttpUrl(raw)) return false;
  return raw.startsWith("file://") || raw.startsWith("MEDIA:") || raw.startsWith("attachment://") || raw.startsWith("/") || raw.startsWith("~") || /^[a-zA-Z]:[\\/]/.test(raw);
}

/**
 * 归一化本地媒体路径。
 *
 * @param raw - 支持普通路径、file://、MEDIA:、attachment://、`~` 与转义空格。
 * @returns 绝对路径；无法解析 file URL 时会退回字符串替换方案。
 */
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

/**
 * 去除 Markdown URL 中的 title 段。
 *
 * @param value - 可能包含 `"title"` 的 URL 字符串。
 * @returns 不带 title 的 URL/路径。
 */
export function stripTitleFromUrl(value: string): string {
  const m = value.trim().match(/^(\S+)\s+["'][^"']*["']\s*$/);
  return m ? m[1] : value.trim();
}

/**
 * 获取文件扩展名。
 *
 * @param filePath - URL、文件名或本地路径。
 * @returns 小写且不含点号的扩展名。
 */
export function getExtension(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return ext.startsWith(".") ? ext.slice(1) : ext;
}

/**
 * 判断路径是否属于图片扩展名。
 *
 * @param filePath - URL、文件名或本地路径。
 * @returns `true` 表示应作为图片处理。
 */
export function isImagePath(filePath: string): boolean { return IMAGE_EXTENSIONS.has(getExtension(filePath)); }
/**
 * 判断路径是否属于非图片文件扩展名。
 *
 * @param filePath - URL、文件名或本地路径。
 * @returns `true` 表示应作为文件附件处理。
 */
export function isNonImageFilePath(filePath: string): boolean { return NON_IMAGE_EXTENSIONS.has(getExtension(filePath)); }

/**
 * 根据扩展名推断媒体类型。
 *
 * @param filePath - URL、文件名或本地路径。
 * @returns image/audio/video/file 四类之一。
 */
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

/**
 * 将单个命中的 URL/路径转换为 ExtractedMedia。
 *
 * @param source - 从文本中提取出的媒体引用。
 * @param sourceKind - 引用来源，供调用方审计或调试。
 * @param options - 当前解析选项；保留给未来需要按选项调整判定逻辑。
 * @returns 结构化媒体描述，不做真实 I/O。
 */
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

/**
 * 从文本中提取图片和文件引用。
 *
 * 解析顺序固定为 MEDIA 行、Markdown linked image、Markdown image、HTML img、
 * Markdown file link、裸露图片路径、裸露文件路径。这个顺序能避免 Markdown 图片
 * 先被普通 link 或裸路径误判，也便于按 replacement 位置安全删除原始文本片段。
 *
 * @param text - 待解析文本。
 * @param options - 控制是否删除原文、是否检查本地文件存在、启用哪些语法解析。
 * @returns 清理后的文本、图片列表、文件列表和合并后的 all 列表。
 */
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
    // 从后往前替换，避免前面的替换改变后续 match 的索引。
    replacements.sort((a, b) => b.start - a.start);
    for (const { start, end, replacement } of replacements) result = result.slice(0, start) + replacement + result.slice(end);
    replacements.length = 0;
  };

  // 0. MEDIA: 行指令。该语法常由 Agent/插件显式输出，优先级最高。
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

  // 1. Markdown linked images。先处理 `[![alt](img)](target)`，避免被普通 Markdown image 抢先匹配。
  if (parseMarkdownImages) {
    for (const m of text.matchAll(MARKDOWN_LINKED_IMAGE_RE)) {
      const media = createExtractedMedia(m[2], "markdown", options);
      if (media.type === "image" && addMedia(media) && removeFromText && m.index !== undefined) {
        replacements.push({ start: m.index, end: m.index + m[0].length, replacement: "" });
      }
    }
    applyReplacements();
  }

  // 2. Markdown images。只提取图片资源，必要时从正文中移除原始语法。
  if (parseMarkdownImages) {
    for (const m of result.matchAll(MARKDOWN_IMAGE_RE)) {
      const media = createExtractedMedia(m[2], "markdown", options);
      if (media.type === "image" && addMedia(media) && removeFromText && m.index !== undefined) {
        replacements.push({ start: m.index, end: m.index + m[0].length, replacement: "" });
      }
    }
    applyReplacements();
  }

  // 3. HTML img。兼容模型或上游系统输出的 HTML 图片标签。
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

  // 4. Markdown links (files)。只把本地/附件链接识别为文件，避免把普通网页链接当附件。
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

  // 5. Bare image paths。过滤 Markdown 链接上下文，避免重复提取。
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

  // 6. Bare file paths。最后处理裸文件路径，防止覆盖更高优先级语法的替换结果。
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

/**
 * extractImagesFromText 是 media 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
 */
export function extractImagesFromText(text: string, options: Omit<MediaParseOptions, "parseMarkdownLinks"> = {}): { text: string; images: ExtractedMedia[] } {
  const r = extractMediaFromText(text, { ...options, parseMarkdownLinks: false });
  return { text: r.text, images: r.images };
}

/**
 * extractFilesFromText 是 media 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
 */
export function extractFilesFromText(text: string, options: Omit<MediaParseOptions, "parseMarkdownImages" | "parseHtmlImages"> = {}): { text: string; files: ExtractedMedia[] } {
  const r = extractMediaFromText(text, { ...options, parseMarkdownImages: false, parseHtmlImages: false });
  return { text: r.text, files: r.files };
}
