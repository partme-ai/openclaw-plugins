/**
 * @module wechat/cdn/cdn-upload
 *
 * 微信 CDN 媒体上传。
 */

import { encryptAesEcb } from "./aes-ecb.js";
import { buildCdnUploadUrl } from "./cdn-url.js";
import { logger } from "../util/logger.js";
import { redactUrl } from "../util/redact.js";
import { validateWeixinCdnUploadUrl } from "../api/endpoint-policy.js";

/** Maximum retry attempts for CDN upload. */
const UPLOAD_MAX_RETRIES = 3;
const UPLOAD_TIMEOUT_MS = 30_000;
const MAX_ERROR_BODY_BYTES = 4 * 1024;

/** 只读取很小的错误摘要，避免异常 CDN 用巨大响应耗尽 Gateway 内存。 */
async function readErrorSnippet(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (total < MAX_ERROR_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = MAX_ERROR_BODY_BYTES - total;
      chunks.push(Buffer.from(value.subarray(0, remaining)));
      total += Math.min(value.byteLength, remaining);
      if (value.byteLength > remaining || total >= MAX_ERROR_BODY_BYTES) {
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString("utf-8");
}

function retryDelayMs(attempt: number): number {
  return Math.min(1_000, 200 * 2 ** (attempt - 1));
}

async function waitBeforeRetry(attempt: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
}

/**
 * Upload one buffer to the Weixin CDN with AES-128-ECB encryption.
 * Returns the download encrypted_query_param from the CDN response.
 * Retries up to UPLOAD_MAX_RETRIES times on server errors; client errors (4xx) abort immediately.
 */
export async function uploadBufferToCdn(params: {
  buf: Buffer;
  /** From getUploadUrl.upload_full_url; POST target when set (takes precedence over uploadParam). */
  uploadFullUrl?: string;
  uploadParam?: string;
  filekey: string;
  cdnBaseUrl: string;
  label: string;
  aeskey: Buffer;
}): Promise<{ downloadParam: string }> {
  const { buf, uploadFullUrl, uploadParam, filekey, cdnBaseUrl, label, aeskey } = params;
  const ciphertext = encryptAesEcb(buf, aeskey);
  const trimmedFull = uploadFullUrl?.trim();
  let cdnUrl: string;
  if (trimmedFull) {
    cdnUrl = validateWeixinCdnUploadUrl(trimmedFull, cdnBaseUrl);
  } else if (uploadParam) {
    cdnUrl = validateWeixinCdnUploadUrl(
      buildCdnUploadUrl({ cdnBaseUrl, uploadParam, filekey }),
      cdnBaseUrl,
    );
  } else {
    throw new Error(`${label}: CDN upload URL missing (need upload_full_url or upload_param)`);
  }
  logger.debug(`${label}: CDN POST url=${redactUrl(cdnUrl)} ciphertextSize=${ciphertext.length}`);

  let downloadParam: string | undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= UPLOAD_MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
      timeout.unref?.();
      let res: Response;
      try {
        res = await fetch(cdnUrl, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: new Uint8Array(ciphertext),
          redirect: "error",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (res.status >= 400 && res.status < 500) {
        const headerMessage = res.headers.get("x-error-message");
        const errMsg = headerMessage?.slice(0, MAX_ERROR_BODY_BYTES) ?? (await readErrorSnippet(res));
        if (headerMessage) await res.body?.cancel().catch(() => {});
        logger.error(
          `${label}: CDN client error attempt=${attempt} status=${res.status} errMsg=${errMsg}`,
        );
        throw new Error(`CDN upload client error ${res.status}: ${errMsg}`);
      }
      if (res.status !== 200) {
        const errMsg = res.headers.get("x-error-message")?.slice(0, MAX_ERROR_BODY_BYTES) ?? `status ${res.status}`;
        await res.body?.cancel().catch(() => {});
        logger.error(
          `${label}: CDN server error attempt=${attempt} status=${res.status} errMsg=${errMsg}`,
        );
        throw new Error(`CDN upload server error: ${errMsg}`);
      }
      downloadParam = res.headers.get("x-encrypted-param") ?? undefined;
      if (!downloadParam) {
        await res.body?.cancel().catch(() => {});
        logger.error(
          `${label}: CDN response missing x-encrypted-param header attempt=${attempt}`,
        );
        throw new Error("CDN upload response missing x-encrypted-param header");
      }
      await res.body?.cancel().catch(() => {});
      logger.debug(`${label}: CDN upload success attempt=${attempt}`);
      break;
    } catch (err) {
      lastError = err;
      if (err instanceof Error && err.message.includes("client error")) throw err;
      if (attempt < UPLOAD_MAX_RETRIES) {
        logger.error(`${label}: attempt ${attempt} failed, retrying... err=${String(err)}`);
        await waitBeforeRetry(attempt);
      } else {
        logger.error(`${label}: all ${UPLOAD_MAX_RETRIES} attempts failed err=${String(err)}`);
      }
    }
  }

  if (!downloadParam) {
    throw lastError instanceof Error
      ? lastError
      : new Error(`CDN upload failed after ${UPLOAD_MAX_RETRIES} attempts`);
  }
  return { downloadParam };
}
