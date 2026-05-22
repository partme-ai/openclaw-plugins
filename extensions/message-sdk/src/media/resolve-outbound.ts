/**
 * 出站媒体加载：远程 URL 或本机路径 → buffer + contentType。
 */

import { importOpenClawPluginSdk } from "../openclaw-loader.js";

export type ResolvedOutboundMedia = {
  buffer: Buffer;
  contentType?: string;
  filename: string;
  sourcePath: string;
};

export type ResolveOutboundMediaParams = {
  pathOrUrl: string;
  mimeByExt?: Record<string, string>;
  fetchRemoteMedia?: (params: { url: string }) => Promise<{
    buffer: Buffer;
    contentType?: string;
    fileName?: string;
  }>;
};

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
 */
export function isHttpMediaUrl(pathOrUrl: string): boolean {
  return /^https?:\/\//i.test(pathOrUrl.trim());
}

/**
 * 从路径或 URL 加载出站媒体字节。
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

  const fs = await import("node:fs/promises");
  const pathMod = await import("node:path");
  const buf = await fs.readFile(sourcePath);
  const filename = pathMod.basename(sourcePath);
  const ext = pathMod.extname(sourcePath).slice(1).toLowerCase();
  const contentType = mimeByExt[ext] ?? "application/octet-stream";
  return { buffer: buf, contentType, filename, sourcePath };
}

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
 */
export function isImageContentType(contentType: string | undefined): boolean {
  return Boolean(contentType?.startsWith("image/"));
}
