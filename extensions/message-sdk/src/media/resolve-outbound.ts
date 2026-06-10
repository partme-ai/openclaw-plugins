/**
 * @module media/resolve-outbound
 *
 * 出站媒体加载：远程 URL 或本机路径 → buffer + contentType。
 *
 * **职责**：为通道插件发送图片/文件附件时，统一加载媒体字节与 MIME 推断。
 *
 * **关键导出**：`resolveOutboundMedia`、`isHttpMediaUrl`、`isImageContentType`
 */

import { importOpenClawPluginSdk } from "../openclaw/loader.js";

/**
 * 已解析的出站媒体结果 / Resolved outbound media payload.
 *
 * @property buffer - 媒体二进制内容
 * @property contentType - MIME 类型（可选，远程加载时由响应头推断）
 * @property filename - 建议的文件名（用于附件展示）
 * @property sourcePath - 原始路径或 URL（审计/日志用）
 */
export type ResolvedOutboundMedia = {
  buffer: Buffer;
  contentType?: string;
  filename: string;
  sourcePath: string;
};

/**
 * `resolveOutboundMedia` 调用参数 / Parameters for resolving outbound media.
 *
 * @property pathOrUrl - 本机绝对路径或 http(s) URL
 * @property mimeByExt - 扩展名 → MIME 映射（覆盖默认图片类型表）
 * @property fetchRemoteMedia - 自定义远程 fetch（测试或特殊代理场景）
 */
export type ResolveOutboundMediaParams = {
  pathOrUrl: string;
  mimeByExt?: Record<string, string>;
  fetchRemoteMedia?: (params: { url: string }) => Promise<{
    buffer: Buffer;
    contentType?: string;
    fileName?: string;
  }>;
};

/** 默认图片扩展名 → MIME 映射 */
const DEFAULT_IMAGE_EXTS: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

/**
 * 判断是否为 http(s) URL。
 *
 * @param pathOrUrl - 待检测的路径或 URL 字符串
 * @returns `true` 表示应走远程 fetch 分支
 *
 * @example
 * ```ts
 * isHttpMediaUrl("https://cdn.example.com/a.png"); // true
 * isHttpMediaUrl("/Users/me/a.png");               // false
 * ```
 */
export function isHttpMediaUrl(pathOrUrl: string): boolean {
  return /^https?:\/\//i.test(pathOrUrl.trim());
}

/**
 * 从路径或 URL 加载出站媒体字节。
 *
 * - **远程 URL**：调用 `fetchRemoteMedia` 或 OpenClaw `channel-media` SDK
 * - **本机路径**：直接 `fs.readFile`，按扩展名推断 contentType
 *
 * @param params - 解析参数（见 {@link ResolveOutboundMediaParams}）
 * @returns 媒体 buffer、MIME、文件名与来源路径
 * @throws 本机文件不存在、远程 fetch 失败，或 OpenClaw peer 不可用时抛出
 *
 * @example
 * ```ts
 * const media = await resolveOutboundMedia({ pathOrUrl: "/tmp/out.png" });
 * await channel.sendImage({ buffer: media.buffer, filename: media.filename });
 * ```
 */
export async function resolveOutboundMedia(
  params: ResolveOutboundMediaParams,
): Promise<ResolvedOutboundMedia> {
  const sourcePath = params.pathOrUrl.trim();
  const mimeByExt = { ...DEFAULT_IMAGE_EXTS, ...params.mimeByExt };

  if (isHttpMediaUrl(sourcePath)) {
    const fetcher =
      params.fetchRemoteMedia ??
      (await resolveDefaultFetchRemoteMedia());
    const loaded = await fetcher({ url: sourcePath });
    return {
      buffer: loaded.buffer,
      contentType: loaded.contentType,
      filename: loaded.fileName ?? "attachment",
      sourcePath,
    };
  }

  // 本机路径分支：读取文件并按扩展名推断 MIME
  const fs = await import("node:fs/promises");
  const pathMod = await import("node:path");
  const buf = await fs.readFile(sourcePath);
  const filename = pathMod.basename(sourcePath);
  const ext = pathMod.extname(sourcePath).slice(1).toLowerCase();
  const contentType = mimeByExt[ext] ?? "application/octet-stream";
  return { buffer: buf, contentType, filename, sourcePath };
}

/** 解析 OpenClaw channel-media SDK 提供的默认远程 fetch 实现 */
async function resolveDefaultFetchRemoteMedia(): Promise<
  NonNullable<ResolveOutboundMediaParams["fetchRemoteMedia"]>
> {
  const sdk = await importOpenClawPluginSdk<{
    fetchRemoteMedia?: ResolveOutboundMediaParams["fetchRemoteMedia"];
  }>("channel-media");
  if (typeof sdk?.fetchRemoteMedia === "function") {
    return sdk.fetchRemoteMedia;
  }
  throw new Error("fetchRemoteMedia not available (OpenClaw peer or explicit fetchRemoteMedia required)");
}

/**
 * 根据 contentType 判断是否为图片。
 *
 * @param contentType - MIME 类型字符串（如 `image/png`）
 * @returns `true` 表示 `contentType` 以 `image/` 开头
 *
 * @example
 * ```ts
 * isImageContentType("image/jpeg");        // true
 * isImageContentType("application/pdf");   // false
 * isImageContentType(undefined);           // false
 * ```
 */
export function isImageContentType(contentType: string | undefined): boolean {
  return Boolean(contentType?.startsWith("image/"));
}
