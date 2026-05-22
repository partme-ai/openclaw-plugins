/**
 * 媒体 IO 模块
 *
 * 统一的媒体文件下载、读取、归档和清理功能。
 * 来源：openclaw-china packages/shared/src/media/media-io.ts (746行)
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
 * MediaReadResult 描述 media 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface MediaReadResult {
  buffer: Buffer;
  fileName: string;
  size: number;
  mimeType?: string;
}

/**
 * DownloadToTempFileResult 描述 media 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface DownloadToTempFileResult {
  path: string;
  fileName: string;
  contentType: string;
  size: number;
  sourceFileName?: string;
}

/**
 * MediaReadOptions 描述 media 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface MediaReadOptions {
  timeout?: number;
  maxSize?: number;
  fetch?: typeof globalThis.fetch;
}

/**
 * DownloadToTempFileOptions 描述 media 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface DownloadToTempFileOptions extends MediaReadOptions {
  tempDir?: string;
  tempPrefix?: string;
  sourceFileName?: string;
}

/**
 * FinalizeInboundMediaOptions 描述 media 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface FinalizeInboundMediaOptions {
  filePath: string;
  tempDir: string;
  inboundDir: string;
}

/**
 * PruneInboundMediaDirOptions 描述 media 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface PruneInboundMediaDirOptions {
  inboundDir: string;
  keepDays: number;
  nowMs?: number;
}

/**
 * PathSecurityOptions 描述 media 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface PathSecurityOptions {
  allowedPrefixes?: string[];
  maxPathLength?: number;
  preventTraversal?: boolean;
}

// ============================================================================
// 错误
// ============================================================================

/**
 * FileSizeLimitError 表示 media 模块中的可实例化能力。
 *
 * 类实例通常持有内存状态或错误语义；调用方应通过公开方法读取或更新状态，
 * 不要依赖内部字段布局。
 */
export class FileSizeLimitError extends Error {
  constructor(message: string, public readonly actualSize: number, public readonly limitSize: number) {
    super(message);
    this.name = "FileSizeLimitError";
  }
}

/**
 * MediaTimeoutError 表示 media 模块中的可实例化能力。
 *
 * 类实例通常持有内存状态或错误语义；调用方应通过公开方法读取或更新状态，
 * 不要依赖内部字段布局。
 */
export class MediaTimeoutError extends Error {
  constructor(message: string, public readonly timeoutMs: number) {
    super(message);
    this.name = "MediaTimeoutError";
  }
}

/**
 * PathSecurityError 表示 media 模块中的可实例化能力。
 *
 * 类实例通常持有内存状态或错误语义；调用方应通过公开方法读取或更新状态，
 * 不要依赖内部字段布局。
 */
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
 * getMimeType 是 media 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
 */
export function getMimeType(filePath: string): string | undefined {
  const ext = getExtension(filePath);
  return EXT_TO_MIME[ext];
}

// ============================================================================
// 路径安全
// ============================================================================

/**
 * validatePathSecurity 是 media 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
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
 * getDefaultAllowedPrefixes 是 media 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
 */
export function getDefaultAllowedPrefixes(): string[] {
  if (process.platform === "win32") return [os.tmpdir(), os.homedir()];
  return DEFAULT_UNIX_PREFIXES;
}

// ============================================================================
// 媒体读取
// ============================================================================

/**
 * fetchMediaFromUrl 是 media 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
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
 * downloadToTempFile 是 media 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
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
 * readMediaFromLocal 是 media 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
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
 * readMedia 是 media 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
 */
export async function readMedia(source: string, options: MediaReadOptions & PathSecurityOptions = {}): Promise<MediaReadResult> {
  if (isHttpUrl(source)) return fetchMediaFromUrl(source, options);
  return readMediaFromLocal(source, options);
}

/**
 * readMediaBatch 是 media 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
 */
export async function readMediaBatch(sources: string[], options: MediaReadOptions & PathSecurityOptions = {}): Promise<Array<{ source: string; result?: MediaReadResult; error?: Error }>> {
  const results = await Promise.allSettled(sources.map((s) => readMedia(s, options)));
  return results.map((r, i) => r.status === "fulfilled" ? { source: sources[i], result: r.value } : { source: sources[i], error: r.reason as Error });
}

// ============================================================================
// 归档与清理
// ============================================================================

/**
 * finalizeInboundMediaFile 是 media 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
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
 * pruneInboundMediaDir 是 media 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
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
 * cleanupFileSafe 是 media 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
 */
export async function cleanupFileSafe(filePath: string | undefined, onError?: (error: unknown, filePath: string) => void): Promise<void> {
  if (!filePath) return;
  try { await fsPromises.unlink(filePath); } catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") onError?.(err, filePath); }
}
