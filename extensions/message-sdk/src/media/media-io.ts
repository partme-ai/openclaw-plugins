/**
 * @module media/media-io
 *
 * 媒体 IO 模块 — 统一下载、读取、归档与清理。
 *
 * **职责**：
 * - 远程 URL / 本机路径 → Buffer（带大小与超时限制）
 * - 入站媒体从临时目录归档到按日期分目录的 inbound 目录
 * - 过期 inbound 文件清理
 *
 * **来源**：openclaw-china packages/shared/src/media/media-io.ts (MIT License)
 *
 * **关键导出**：`fetchMediaFromUrl`、`readMedia`、`downloadToTempFile`、
 * `finalizeInboundMediaFile`、`pruneInboundMediaDir`
 */

import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { isHttpUrl, normalizeLocalPath, getExtension } from "./media-parser.js";
import { resolveExtension } from "../file/file-utils.js";

// ============================================================================
// 类型
// ============================================================================

/**
 * 媒体读取结果 / Result of reading media from URL or local path.
 *
 * @property buffer - 文件二进制内容
 * @property fileName - 推断的文件名
 * @property size - 字节数
 * @property mimeType - MIME 类型（可选）
 */
export interface MediaReadResult {
  buffer: Buffer;
  fileName: string;
  size: number;
  mimeType?: string;
}

/**
 * 下载到临时文件的结果 / Result of streaming download to temp file.
 *
 * @property path - 临时文件绝对路径
 * @property fileName - 生成的临时文件名
 * @property contentType - 响应 Content-Type
 * @property size - 实际写入字节数
 * @property sourceFileName - 原始文件名（Content-Disposition 或 URL 推断）
 */
export interface DownloadToTempFileResult {
  path: string;
  fileName: string;
  contentType: string;
  size: number;
  sourceFileName?: string;
}

/**
 * 媒体读取选项 / Options for read/fetch operations.
 *
 * @property timeout - 超时毫秒（默认 30000）
 * @property maxSize - 最大字节数（默认 100MB）
 * @property fetch - 自定义 fetch 实现（测试用）
 */
export interface MediaReadOptions {
  timeout?: number;
  maxSize?: number;
  fetch?: typeof globalThis.fetch;
}

/**
 * 下载到临时文件的选项 / Options extending {@link MediaReadOptions}.
 *
 * @property tempDir - 临时目录（默认 `os.tmpdir()`）
 * @property tempPrefix - 临时文件名前缀
 * @property sourceFileName - 覆盖源文件名推断
 */
export interface DownloadToTempFileOptions extends MediaReadOptions {
  tempDir?: string;
  tempPrefix?: string;
  sourceFileName?: string;
}

/**
 * 入站媒体归档选项 / Options for moving temp file into inbound archive.
 *
 * @property filePath - 当前临时文件路径
 * @property tempDir - 临时根目录（仅归档此目录下的文件）
 * @property inboundDir - 入站持久化根目录
 */
export interface FinalizeInboundMediaOptions {
  filePath: string;
  tempDir: string;
  inboundDir: string;
}

/**
 * 清理过期 inbound 媒体目录的选项 / Options for pruning dated inbound folders.
 *
 * @property inboundDir - 入站根目录（含 `YYYY-MM-DD` 子目录）
 * @property keepDays - 保留天数（早于 cutoff 的文件会被删除）
 * @property nowMs - 可选当前时间戳（测试用）
 */
export interface PruneInboundMediaDirOptions {
  inboundDir: string;
  keepDays: number;
  nowMs?: number;
}

/**
 * 本机路径安全校验选项 / Path security validation options.
 *
 * @property allowedPrefixes - 允许的路径前缀白名单
 * @property maxPathLength - 最大路径长度（默认 4096）
 * @property preventTraversal - 是否拒绝 `..` 穿越（默认 true）
 */
export interface PathSecurityOptions {
  allowedPrefixes?: string[];
  maxPathLength?: number;
  preventTraversal?: boolean;
}

// ============================================================================
// 错误
// ============================================================================

/** 文件大小超出限制 / File exceeds configured size limit */
export class FileSizeLimitError extends Error {
  constructor(message: string, public readonly actualSize: number, public readonly limitSize: number) {
    super(message);
    this.name = "FileSizeLimitError";
  }
}

/** 媒体下载/读取超时 / Media fetch or read timed out */
export class MediaTimeoutError extends Error {
  constructor(message: string, public readonly timeoutMs: number) {
    super(message);
    this.name = "MediaTimeoutError";
  }
}

/** 路径未通过安全校验 / Path failed security validation */
export class PathSecurityError extends Error {
  constructor(message: string, public readonly unsafePath: string, public readonly reason: string) {
    super(message);
    this.name = "PathSecurityError";
  }
}

// ============================================================================
// 常量
// ============================================================================

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_SIZE = 100 * 1024 * 1024;
const DEFAULT_MAX_PATH_LENGTH = 4096;
const DEFAULT_UNIX_PREFIXES = ["/tmp", "/var/tmp", "/private/tmp", "/Users", "/home", "/root"];

// ============================================================================
// MIME 表
// ============================================================================

const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml", ico: "image/x-icon",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/x-m4a", amr: "audio/amr",
  mp4: "video/mp4", mov: "video/quicktime", avi: "video/x-msvideo", mkv: "video/x-matroska", webm: "video/webm",
  pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain", csv: "text/csv", zip: "application/zip", rar: "application/x-rar-compressed", "7z": "application/x-7z-compressed", tar: "application/x-tar", gz: "application/gzip",
};

// ============================================================================
// 辅助函数
// ============================================================================

function parseContentDispositionFilename(value: string | null): string | undefined {
  if (!value) return undefined;
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) { try { return decodeURIComponent(utf8Match[1].trim()); } catch { return utf8Match[1].trim(); } }
  const plainMatch = value.match(/filename=([^;]+)/i);
  if (!plainMatch?.[1]) return undefined;
  return plainMatch[1].trim().replace(/^["']|["']$/g, "") || undefined;
}

function sanitizeFileName(name: string): string {
  const normalized = name.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
  return normalized || "file";
}

function resolveFileNameFromUrl(url: string): string | undefined {
  try { const base = path.basename(new URL(url).pathname); return base && base !== "/" ? base : undefined; } catch { return undefined; }
}

function normalizeForCompare(value: string): string { return path.resolve(value).replace(/\\/g, "/").toLowerCase(); }

function isPathUnderDir(filePath: string, dirPath: string): boolean {
  const f = normalizeForCompare(filePath);
  const d = normalizeForCompare(dirPath).replace(/\/+$/, "");
  return f === d || f.startsWith(`${d}/`);
}

function formatDateDir(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * 根据文件路径扩展名推断 MIME 类型。
 *
 * @param filePath - 文件名或路径
 * @returns MIME 字符串；未知扩展名时返回 `undefined`
 */
export function getMimeType(filePath: string): string | undefined {
  const ext = getExtension(filePath);
  return EXT_TO_MIME[ext];
}

// ============================================================================
// 路径安全
// ============================================================================

/**
 * 校验本机路径是否满足安全策略。
 *
 * @param filePath - 待访问路径
 * @param options - 白名单、长度与穿越检测选项
 * @throws {@link PathSecurityError} 路径过长、穿越或不在白名单内
 */
export function validatePathSecurity(filePath: string, options: PathSecurityOptions = {}): void {
  const { allowedPrefixes, maxPathLength = DEFAULT_MAX_PATH_LENGTH, preventTraversal = true } = options;
  if (filePath.length > maxPathLength) throw new PathSecurityError(`Path length ${filePath.length} > ${maxPathLength}`, filePath, "path too long");
  if (preventTraversal && path.normalize(filePath).includes("..")) throw new PathSecurityError("Path traversal detected", filePath, "traversal");
  if (allowedPrefixes?.length) {
    const np = path.normalize(filePath);
    if (!allowedPrefixes.some((p) => np.startsWith(path.normalize(p)))) throw new PathSecurityError("Path not in allowed prefixes", filePath, "not allowed");
  }
}

/**
 * 返回平台默认的允许路径前缀列表。
 *
 * @returns Unix 为 `/tmp`、`/Users` 等；Windows 为 `tmpdir()` 与 `homedir()`
 */
export function getDefaultAllowedPrefixes(): string[] {
  if (process.platform === "win32") return [os.tmpdir(), os.homedir()];
  return DEFAULT_UNIX_PREFIXES;
}

// ============================================================================
// 媒体读取
// ============================================================================

/**
 * 从 HTTP(S) URL 下载媒体到内存 Buffer。
 *
 * @param url - 远程 URL
 * @param options - 超时、大小限制与自定义 fetch
 * @returns 读取结果（含 buffer 与 MIME）
 * @throws {@link FileSizeLimitError} {@link MediaTimeoutError} HTTP 非 2xx
 *
 * @example
 * ```ts
 * const { buffer, mimeType } = await fetchMediaFromUrl("https://cdn.example.com/a.png");
 * ```
 */
export async function fetchMediaFromUrl(url: string, options: MediaReadOptions = {}): Promise<MediaReadResult> {
  const { timeout = DEFAULT_TIMEOUT, maxSize = DEFAULT_MAX_SIZE, fetch: customFetch = globalThis.fetch } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await customFetch(url, { signal: controller.signal });
    if (!response.ok) { const et = await response.text(); throw new Error(`HTTP ${response.status}: ${et}`); }
    const cl = response.headers.get("content-length");
    if (cl) { const size = parseInt(cl, 10); if (size > maxSize) throw new FileSizeLimitError(`Content-Length ${size} > ${maxSize}`, size, maxSize); }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length > maxSize) throw new FileSizeLimitError(`Size ${buffer.length} > ${maxSize}`, buffer.length, maxSize);
    let fileName = "file";
    try { const urlPath = new URL(url).pathname; fileName = path.basename(urlPath) || "file"; } catch { /* ignore */ }
    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || getMimeType(fileName);
    return { buffer, fileName, size: buffer.length, mimeType };
  } catch (err) { if (err instanceof Error && err.name === "AbortError") throw new MediaTimeoutError(`Timeout after ${timeout}ms`, timeout); throw err; }
  finally { clearTimeout(timeoutId); }
}

/**
 * 流式下载 URL 到临时文件（适合大文件，边读边校验大小）。
 *
 * @param url - 必须为 HTTP(S) URL
 * @param options - 超时、大小、临时目录与前缀
 * @returns 临时文件路径与元数据
 * @throws 非 HTTP URL、超时或超出 `maxSize` 时抛错
 */
export async function downloadToTempFile(url: string, options: DownloadToTempFileOptions = {}): Promise<DownloadToTempFileResult> {
  if (!isHttpUrl(url)) throw new Error(`downloadToTempFile expects HTTP URL, got: ${url}`);
  const { timeout = DEFAULT_TIMEOUT, maxSize = DEFAULT_MAX_SIZE, fetch: customFetch = globalThis.fetch, tempDir = os.tmpdir(), tempPrefix = "media", sourceFileName } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await customFetch(url, { signal: controller.signal });
    if (!response.ok) { const body = await response.text().catch(() => ""); throw new Error(`HTTP ${response.status}: ${body}`); }
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
    const cl = response.headers.get("content-length");
    if (cl) { const declared = parseInt(cl, 10); if (!Number.isNaN(declared) && declared > maxSize) throw new FileSizeLimitError(`Content-Length ${declared} > ${maxSize}`, declared, maxSize); }
    const body = response.body;
    if (!body) throw new Error("Response body is null");
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    const reader = body.getReader();
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; totalBytes += value.length; if (totalBytes > maxSize) { reader.cancel(); throw new FileSizeLimitError(`Stream size ${totalBytes} > ${maxSize}`, totalBytes, maxSize); } chunks.push(value); }
    } finally { reader.releaseLock(); }
    const sourceName = sourceFileName || parseContentDispositionFilename(response.headers.get("content-disposition")) || resolveFileNameFromUrl(url) || "file";
    const safePrefix = sanitizeFileName(tempPrefix) || "media";
    const ext = resolveExtension(contentType, sourceName);
    const random = Math.random().toString(36).slice(2, 8);
    const fileName = `${safePrefix}-${Date.now()}-${random}${ext}`;
    const fullPath = path.join(tempDir, fileName);
    await fsPromises.mkdir(tempDir, { recursive: true });
    const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    await fsPromises.writeFile(fullPath, buffer);
    return { path: fullPath, fileName, contentType, size: totalBytes, sourceFileName: sourceName };
  } catch (err) { if (err instanceof Error && err.name === "AbortError") throw new MediaTimeoutError(`Timeout after ${timeout}ms`, timeout); throw err; }
  finally { clearTimeout(timeoutId); }
}

/**
 * 从本机路径读取媒体（含路径安全校验）。
 *
 * @param filePath - 本机路径（支持 `media-parser` 归一化格式）
 * @param options - 大小限制与安全选项
 * @returns 读取结果
 * @throws 文件不存在、过大或路径不安全
 */
export async function readMediaFromLocal(filePath: string, options: MediaReadOptions & PathSecurityOptions = {}): Promise<MediaReadResult> {
  const { maxSize = DEFAULT_MAX_SIZE } = options;
  const localPath = normalizeLocalPath(filePath);
  validatePathSecurity(localPath, options);
  if (!fs.existsSync(localPath)) throw new Error(`File not found: ${localPath}`);
  const stats = await fsPromises.stat(localPath);
  if (stats.size > maxSize) throw new FileSizeLimitError(`File size ${stats.size} > ${maxSize}`, stats.size, maxSize);
  const buffer = await fsPromises.readFile(localPath);
  const fileName = path.basename(localPath);
  const mimeType = getMimeType(localPath);
  return { buffer, fileName, size: buffer.length, mimeType };
}

/**
 * 统一读取媒体：自动区分 HTTP URL 与本机路径。
 *
 * @param source - URL 或本机路径
 * @param options - 读取与安全选项
 * @returns 读取结果
 */
export async function readMedia(source: string, options: MediaReadOptions & PathSecurityOptions = {}): Promise<MediaReadResult> {
  if (isHttpUrl(source)) return fetchMediaFromUrl(source, options);
  return readMediaFromLocal(source, options);
}

/**
 * 批量读取多个媒体源（单个失败不影响其余）。
 *
 * @param sources - URL 或路径列表
 * @param options - 读取选项
 * @returns 每项含 `result` 或 `error`，与输入顺序一一对应
 */
export async function readMediaBatch(sources: string[], options: MediaReadOptions & PathSecurityOptions = {}): Promise<Array<{ source: string; result?: MediaReadResult; error?: Error }>> {
  const results = await Promise.allSettled(sources.map((s) => readMedia(s, options)));
  return results.map((r, i) => r.status === "fulfilled" ? { source: sources[i], result: r.value } : { source: sources[i], error: r.reason as Error });
}

// ============================================================================
// 归档与清理
// ============================================================================

/**
 * 将临时目录中的入站媒体移动到按日期分层的 inbound 目录。
 *
 * 若文件不在 `tempDir` 下则原样返回路径；跨设备移动失败时尝试 copy+unlink。
 *
 * @param options - 文件路径与目录配置
 * @returns 归档后的最终路径
 */
export async function finalizeInboundMediaFile(options: FinalizeInboundMediaOptions): Promise<string> {
  const current = String(options.filePath ?? "").trim();
  if (!current) return current;
  if (!isPathUnderDir(current, options.tempDir)) return current;
  const datedDir = path.join(options.inboundDir, formatDateDir());
  const target = path.join(datedDir, path.basename(current));
  try { await fsPromises.mkdir(datedDir, { recursive: true }); await fsPromises.rename(current, target); return target; }
  catch (err) { if ((err as NodeJS.ErrnoException).code === "EXDEV") { try { await fsPromises.copyFile(current, target); try { await fsPromises.unlink(current); } catch { /* ok */ } return target; } catch { return current; } } return current; }
}

/**
 * 清理 inbound 目录中早于 `keepDays` 的 dated 子目录内文件。
 *
 * 仅处理名为 `YYYY-MM-DD` 的子目录；`keepDays < 0` 或非有限值时 no-op。
 *
 * @param options - inbound 根目录与保留天数
 */
export async function pruneInboundMediaDir(options: PruneInboundMediaDirOptions): Promise<void> {
  const keepDays = Number(options.keepDays);
  if (!Number.isFinite(keepDays) || keepDays < 0) return;
  const now = options.nowMs ?? Date.now();
  const cutoff = now - keepDays * 24 * 60 * 60 * 1000;
  let entries: string[] = [];
  try { entries = await fsPromises.readdir(options.inboundDir); } catch { return; }
  for (const entry of entries) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry)) continue;
    const dirPath = path.join(options.inboundDir, entry);
    let dirStats; try { dirStats = await fsPromises.stat(dirPath); } catch { continue; }
    if (!dirStats.isDirectory()) continue;
    if ((dirStats.mtimeMs || dirStats.ctimeMs || 0) >= cutoff) continue;
    let files: string[] = [];
    try { files = await fsPromises.readdir(dirPath); } catch { continue; }
    for (const file of files) { const fp = path.join(dirPath, file); try { const fst = await fsPromises.stat(fp); if (fst.isFile() && (fst.mtimeMs || fst.ctimeMs || 0) < cutoff) await fsPromises.unlink(fp); } catch { /* ignore */ } }
  }
}

/**
 * 安全删除文件（忽略 ENOENT，其它错误可选回调）。
 *
 * @param filePath - 待删除路径；`undefined` 时 no-op
 * @param onError - 非 ENOENT 删除失败时的回调
 */
export async function cleanupFileSafe(filePath: string | undefined, onError?: (error: unknown, filePath: string) => void): Promise<void> {
  if (!filePath) return;
  try { await fsPromises.unlink(filePath); } catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") onError?.(err, filePath); }
}
