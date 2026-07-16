/**
 * @module wechat/cdn/pic-decrypt
 *
 * 微信 CDN 图片解密。
 */

import { decryptAesEcb } from "./aes-ecb.js";
import { buildCdnDownloadUrl, ENABLE_CDN_URL_FALLBACK } from "./cdn-url.js";
import { logger } from "../util/logger.js";

const CDN_DOWNLOAD_TIMEOUT_MS = 30_000;
const CDN_DOWNLOAD_MAX_BYTES = 100 * 1024 * 1024;

function assertSafeCdnUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") {
    throw new Error("CDN download URL must use HTTPS");
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "::1" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error("CDN download URL must not target a local or private address");
  }
  return url;
}

/**
 * Download raw bytes from the CDN (no decryption).
 */
async function fetchCdnBytes(url: string, label: string): Promise<Buffer> {
  const safeUrl = assertSafeCdnUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CDN_DOWNLOAD_TIMEOUT_MS);
  timeout.unref?.();
  let res: Response;
  try {
    res = await fetch(safeUrl, { signal: controller.signal });
  } catch (err) {
    const cause =
      (err as NodeJS.ErrnoException).cause ?? (err as NodeJS.ErrnoException).code ?? "(no cause)";
    logger.error(
      `${label}: fetch network error host=${safeUrl.host} err=${String(err)} cause=${String(cause)}`,
    );
    throw err;
  } finally {
    clearTimeout(timeout);
  }
  logger.debug(`${label}: response status=${res.status} ok=${res.ok}`);
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    const msg = `${label}: CDN download ${res.status} ${res.statusText}`;
    logger.error(msg);
    throw new Error(msg);
  }
  const contentLength = Number(res.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > CDN_DOWNLOAD_MAX_BYTES) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`${label}: CDN response exceeds ${CDN_DOWNLOAD_MAX_BYTES} bytes`);
  }
  if (!res.body) {
    const result = Buffer.from(await res.arrayBuffer());
    if (result.length > CDN_DOWNLOAD_MAX_BYTES) {
      throw new Error(`${label}: CDN response exceeds ${CDN_DOWNLOAD_MAX_BYTES} bytes`);
    }
    return result;
  }
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > CDN_DOWNLOAD_MAX_BYTES) {
        await reader.cancel();
        throw new Error(`${label}: CDN response exceeds ${CDN_DOWNLOAD_MAX_BYTES} bytes`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

/**
 * Parse CDNMedia.aes_key into a raw 16-byte AES key.
 *
 * Two encodings are seen in the wild:
 *   - base64(raw 16 bytes)          → images (aes_key from media field)
 *   - base64(hex string of 16 bytes) → file / voice / video
 *
 * In the second case, base64-decoding yields 32 ASCII hex chars which must
 * then be parsed as hex to recover the actual 16-byte key.
 */
function parseAesKey(aesKeyBase64: string, label: string): Buffer {
  const decoded = Buffer.from(aesKeyBase64, "base64");
  if (decoded.length === 16) {
    return decoded;
  }
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) {
    // hex-encoded key: base64 → hex string → raw bytes
    return Buffer.from(decoded.toString("ascii"), "hex");
  }
  const msg = `${label}: aes_key must decode to 16 raw bytes or 32-char hex string, got ${decoded.length} bytes (base64="${aesKeyBase64}")`;
  logger.error(msg);
  throw new Error(msg);
}

/**
 * Download and AES-128-ECB decrypt a CDN media file. Returns plaintext Buffer.
 * aesKeyBase64: CDNMedia.aes_key JSON field (see parseAesKey for supported formats).
 */
export async function downloadAndDecryptBuffer(
  encryptedQueryParam: string,
  aesKeyBase64: string,
  cdnBaseUrl: string,
  label: string,
  fullUrl?: string,
): Promise<Buffer> {
  const key = parseAesKey(aesKeyBase64, label);
  let url: string;
  if (fullUrl) {
    url = fullUrl;
  } else if (ENABLE_CDN_URL_FALLBACK) {
    url = buildCdnDownloadUrl(encryptedQueryParam, cdnBaseUrl);
  } else {
    throw new Error(`${label}: fullUrl is required (CDN URL fallback is disabled)`);
  }
  logger.debug(`${label}: fetching CDN media`);
  const encrypted = await fetchCdnBytes(url, label);
  logger.debug(`${label}: downloaded ${encrypted.byteLength} bytes, decrypting`);
  const decrypted = decryptAesEcb(encrypted, key);
  logger.debug(`${label}: decrypted ${decrypted.length} bytes`);
  return decrypted;
}

/**
 * Download plain (unencrypted) bytes from the CDN. Returns the raw Buffer.
 */
export async function downloadPlainCdnBuffer(
  encryptedQueryParam: string,
  cdnBaseUrl: string,
  label: string,
  fullUrl?: string,
): Promise<Buffer> {
  let url: string;
  if (fullUrl) {
    url = fullUrl;
  } else if (ENABLE_CDN_URL_FALLBACK) {
    url = buildCdnDownloadUrl(encryptedQueryParam, cdnBaseUrl);
  } else {
    throw new Error(`${label}: fullUrl is required (CDN URL fallback is disabled)`);
  }
  logger.debug(`${label}: fetching CDN media`);
  return fetchCdnBytes(url, label);
}
