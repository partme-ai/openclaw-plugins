/**
 * @module webhook/media
 *
 * Webhook **入站媒体**解密（企微 AES-CBC + PKCS#7）。
 *
 * **职责**：下载加密媒体 URL → AES 解密 → 返回 Buffer 与 HTTP 元信息。
 *
 * **与 message-sdk 关系**：解密后的 Buffer 由 helpers `processInboundMessage` 交给
 * OpenClaw `saveMediaBuffer` 归档；出站 Path Guard 见 `media-path-guard`。
 *
 * **关键导出**：`decryptWecomMediaWithMeta`、`DecryptedWecomMedia`、`WECOM_PKCS7_BLOCK_SIZE`
 */

import crypto from "node:crypto";
import { request } from "undici";
import { fileTypeFromBuffer } from "file-type";
import { pkcs7Unpad, decodeEncodingAESKey } from "@wecom/aibot-node-sdk";
import { REQUEST_TIMEOUT_MS } from "./types.js";
import { wecomFetch, readResponseBodyAsBuffer, type WecomHttpOptions } from "./http.js";

// ============================================================================
// 媒体文件解密
// ============================================================================

/** 企微使用 32 字节 PKCS#7 块大小（不是 AES 的 16 字节块） */
export const WECOM_PKCS7_BLOCK_SIZE = 32;

/** 解密后的媒体文件及源信息（对齐原版 DecryptedWecomMedia） */
export type DecryptedWecomMedia = {
  buffer: Buffer;
  /** HTTP Content-Type（归一化后） */
  sourceContentType?: string;
  /** 从 Content-Disposition 提取的文件名 */
  sourceFilename?: string;
  /** 最终请求 URL（跟随重定向后） */
  sourceUrl?: string;
};


/**
 * 解密企微加密媒体并保留下载响应元信息（Content-Type / 文件名 / 最终 URL）。
 *
 * WHY：企微媒体 URL 内容为 AES 加密；解密后需结合 HTTP 头与 magic bytes 推断 MIME。
 *
 * @param url - 企微提供的加密媒体下载 URL
 * @param encodingAESKey - AES 密钥（43 字符 Base64）
 * @param params.maxBytes - 可选最大下载字节
 * @param params.http - 出站 HTTP 选项（代理/超时）
 * @returns 解密结果 {@link DecryptedWecomMedia}
 */
export async function decryptWecomMediaWithMeta(
  url: string,
  encodingAESKey: string,
  params?: { maxBytes?: number; http?: WecomHttpOptions },
): Promise<DecryptedWecomMedia> {
  // 1. Download encrypted content
  const res = await wecomFetch(url, undefined, { ...params?.http, timeoutMs: params?.http?.timeoutMs ?? 15_000 });
  if (!res.ok) {
    throw new Error(`failed to download media: ${res.status}`);
  }
  const sourceContentType = normalizeMime(res.headers.get("content-type"));
  const sourceFilename = extractFilenameFromContentDisposition(res.headers.get("content-disposition"));
  const sourceUrl = res.url || url;
  const encryptedData = await readResponseBodyAsBuffer(res, params?.maxBytes);

  // 2. Prepare Key and IV
  const aesKey = decodeEncodingAESKey(encodingAESKey);
  const iv = aesKey.subarray(0, 16);

  // 3. Decrypt
  const decipher = crypto.createDecipheriv("aes-256-cbc", aesKey, iv);
  decipher.setAutoPadding(false);
  const decryptedPadded = Buffer.concat([
    decipher.update(encryptedData),
    decipher.final(),
  ]);

  // 4. Unpad
  // Note: Unlike msg bodies, usually removing PKCS#7 padding is enough for media files.
  // The Python SDK logic: pad_len = decrypted_data[-1]; decrypted_data = decrypted_data[:-pad_len]
  // Our pkcs7Unpad function does exactly this + validation.
  return {
    buffer: pkcs7Unpad(decryptedPadded, WECOM_PKCS7_BLOCK_SIZE),
    sourceContentType,
    sourceFilename,
    sourceUrl,
  };
}

// ============================================================================
// HTTP 头信息解析（供 decryptWecomMediaWithMeta 使用）
// ============================================================================

/** 归一化 MIME 类型 */
function normalizeMime(contentType?: string | null): string | undefined {
  const raw = String(contentType ?? "").trim();
  if (!raw) return undefined;
  return raw.split(";")[0]?.trim().toLowerCase() || undefined;
}

/** 从 Content-Disposition 提取文件名 */
function extractFilenameFromContentDisposition(disposition?: string | null): string | undefined {
  const raw = String(disposition ?? "").trim();
  if (!raw) return undefined;

  // 优先 filename*（RFC 5987 编码）
  const star = raw.match(/filename\*\s*=\s*([^;]+)/i);
  if (star?.[1]) {
    const v = star[1].trim().replace(/^UTF-8''/i, "").replace(/^"(.*)"$/, "$1");
    try {
      const decoded = decodeURIComponent(v);
      if (decoded.trim()) return decoded.trim();
    } catch { /* ignore */ }
    if (v.trim()) return v.trim();
  }

  // 再尝试 filename
  const plain = raw.match(/filename\s*=\s*([^;]+)/i);
  if (plain?.[1]) {
    const v = plain[1].trim().replace(/^"(.*)"$/, "$1").trim();
    if (v) return v;
  }
  return undefined;
}
