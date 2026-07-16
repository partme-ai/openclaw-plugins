/**
 * @module wechat/cdn/upload
 *
 * 微信 CDN 上传入口。
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { getUploadUrl } from "../api/api.js";
import type { WeixinApiOptions } from "../api/api.js";
import { aesEcbPaddedSize } from "./aes-ecb.js";
import { uploadBufferToCdn } from "./cdn-upload.js";
import { logger } from "../util/logger.js";
import { getExtensionFromContentTypeOrUrl } from "../media/mime.js";
import { tempFileName } from "../util/random.js";
import { UploadMediaType } from "../api/types.js";

export type UploadedFileInfo = {
  filekey: string;
  /** 由 upload_param 上传后 CDN 返回的下载加密参数; fill into ImageItem.media.encrypt_query_param */
  downloadEncryptedQueryParam: string;
  /** AES-128-ECB key, hex-encoded; convert to base64 for CDNMedia.aes_key */
  aeskey: string;
  /** Plaintext file size in bytes */
  fileSize: number;
  /** Ciphertext file size in bytes (AES-128-ECB with PKCS7 padding); use for ImageItem.hd_size / mid_size */
  fileSizeCiphertext: number;
};

const REMOTE_MEDIA_TIMEOUT_MS = 30_000;
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

function assertSafeRemoteMediaUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") throw new Error("remote media URL must use HTTPS");
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" || host === "::1" || /^127\./.test(host) || /^10\./.test(host) ||
    /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error("remote media URL must not target a local or private address");
  }
  return url;
}

/**
 * Download a remote media URL (image, video, file) to a local temp file in destDir.
 * Returns the local file path; extension is inferred from Content-Type / URL.
 */
export async function downloadRemoteImageToTemp(url: string, destDir: string): Promise<string> {
  const safeUrl = assertSafeRemoteMediaUrl(url);
  logger.debug(`downloadRemoteImageToTemp: fetching host=${safeUrl.host}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_MEDIA_TIMEOUT_MS);
  timeout.unref?.();
  try {
    const res = await fetch(safeUrl, { signal: controller.signal });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      const msg = `remote media download failed: ${res.status} ${res.statusText}`;
      logger.error(`downloadRemoteImageToTemp: ${msg}`);
      throw new Error(msg);
    }
    const declaredSize = Number(res.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredSize) && declaredSize > MAX_MEDIA_BYTES) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`remote media exceeds ${MAX_MEDIA_BYTES} bytes`);
    }
    let buf: Buffer;
    if (!res.body) {
      buf = Buffer.from(await res.arrayBuffer());
    } else {
      const reader = res.body.getReader();
      const chunks: Buffer[] = [];
      let total = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > MAX_MEDIA_BYTES) {
            await reader.cancel();
            throw new Error(`remote media exceeds ${MAX_MEDIA_BYTES} bytes`);
          }
          chunks.push(Buffer.from(value));
        }
      } finally {
        reader.releaseLock();
      }
      buf = Buffer.concat(chunks);
    }
    if (buf.length > MAX_MEDIA_BYTES) throw new Error(`remote media exceeds ${MAX_MEDIA_BYTES} bytes`);
    logger.debug(`downloadRemoteImageToTemp: downloaded ${buf.length} bytes`);
    await fs.mkdir(destDir, { recursive: true });
    const ext = getExtensionFromContentTypeOrUrl(res.headers.get("content-type"), url);
    const name = tempFileName("weixin-remote", ext);
    const filePath = path.join(destDir, name);
    await fs.writeFile(filePath, buf);
    logger.debug(`downloadRemoteImageToTemp: saved remote media ext=${ext}`);
    return filePath;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Common upload pipeline: read file → hash → gen aeskey → getUploadUrl → uploadBufferToCdn → return info.
 */
async function uploadMediaToCdn(params: {
  filePath: string;
  toUserId: string;
  opts: WeixinApiOptions;
  cdnBaseUrl: string;
  mediaType: (typeof UploadMediaType)[keyof typeof UploadMediaType];
  label: string;
}): Promise<UploadedFileInfo> {
  const { filePath, toUserId, opts, cdnBaseUrl, mediaType, label } = params;

  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error(`${label}: media path is not a regular file`);
  if (stat.size > MAX_MEDIA_BYTES) throw new Error(`${label}: media exceeds ${MAX_MEDIA_BYTES} bytes`);
  const plaintext = await fs.readFile(filePath);
  const rawsize = plaintext.length;
  const rawfilemd5 = crypto.createHash("md5").update(plaintext).digest("hex");
  const filesize = aesEcbPaddedSize(rawsize);
  const filekey = crypto.randomBytes(16).toString("hex");
  const aeskey = crypto.randomBytes(16);

  logger.debug(
    `${label}: rawsize=${rawsize} filesize=${filesize}`,
  );

  const uploadUrlResp = await getUploadUrl({
    ...opts,
    filekey,
    media_type: mediaType,
    to_user_id: toUserId,
    rawsize,
    rawfilemd5,
    filesize,
    no_need_thumb: true,
    aeskey: aeskey.toString("hex"),
  });

  const uploadFullUrl = uploadUrlResp.upload_full_url?.trim();
  const uploadParam = uploadUrlResp.upload_param;
  if (!uploadFullUrl && !uploadParam) {
    logger.error(`${label}: getUploadUrl returned no upload URL (need upload_full_url or upload_param)`);
    throw new Error(`${label}: getUploadUrl returned no upload URL`);
  }

  const { downloadParam: downloadEncryptedQueryParam } = await uploadBufferToCdn({
    buf: plaintext,
    uploadFullUrl: uploadFullUrl || undefined,
    uploadParam: uploadParam ?? undefined,
    filekey,
    cdnBaseUrl,
    aeskey,
    label,
  });

  return {
    filekey,
    downloadEncryptedQueryParam,
    aeskey: aeskey.toString("hex"),
    fileSize: rawsize,
    fileSizeCiphertext: filesize,
  };
}

/** Upload a local image file to the Weixin CDN with AES-128-ECB encryption. */
export async function uploadFileToWeixin(params: {
  filePath: string;
  toUserId: string;
  opts: WeixinApiOptions;
  cdnBaseUrl: string;
}): Promise<UploadedFileInfo> {
  return uploadMediaToCdn({
    ...params,
    mediaType: UploadMediaType.IMAGE,
    label: "uploadFileToWeixin",
  });
}

/** Upload a local video file to the Weixin CDN. */
export async function uploadVideoToWeixin(params: {
  filePath: string;
  toUserId: string;
  opts: WeixinApiOptions;
  cdnBaseUrl: string;
}): Promise<UploadedFileInfo> {
  return uploadMediaToCdn({
    ...params,
    mediaType: UploadMediaType.VIDEO,
    label: "uploadVideoToWeixin",
  });
}

/**
 * Upload a local file attachment (non-image, non-video) to the Weixin CDN.
 * Uses media_type=FILE; no thumbnail required.
 */
export async function uploadFileAttachmentToWeixin(params: {
  filePath: string;
  fileName: string;
  toUserId: string;
  opts: WeixinApiOptions;
  cdnBaseUrl: string;
}): Promise<UploadedFileInfo> {
  return uploadMediaToCdn({
    ...params,
    mediaType: UploadMediaType.FILE,
    label: "uploadFileAttachmentToWeixin",
  });
}
