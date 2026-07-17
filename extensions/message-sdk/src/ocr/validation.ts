/**
 * @module ocr/validation
 *
 * OCR provider 的共享输入闸门：凭据、超时、HTTP(S) 图片 URL 与 base64 体积。
 * 这些检查必须发生在创建定时器和网络请求之前，避免明显错误配置进入重试链或构造超大 JSON。
 */

import { OCRAuthError, OCRRequestError } from "./errors.js";
import type { OCRConfig } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** 解析正整数超时；非法配置直接失败。 */
export function resolveOcrTimeout(config: OCRConfig): number {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("OCR timeoutMs must be a positive safe integer");
  }
  return timeoutMs;
}

/** 云端 provider 必须显式提供非空 API Key。 */
export function requireOcrApiKey(provider: string, config: OCRConfig): string {
  if (typeof config.apiKey !== "string" || !config.apiKey.trim()) {
    throw new OCRAuthError(provider, `${provider} apiKey is required`);
  }
  return config.apiKey.trim();
}

/** URL 输入只允许 HTTP(S)，防止把 file/data 等字符串误包装成 base64 图片。 */
export function requireHttpImageUrl(provider: string, value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
    return url.toString();
  } catch {
    throw new OCRRequestError(provider, "OCR image URL must use http or https");
  }
}

/**
 * 校验 base64 语法并在解码/JSON 构造前估算真实字节数。
 * 支持带或不带 `=` padding 的标准 base64，不接受 base64url 与 data URL 头。
 */
export function validateOcrBase64(provider: string, value: string, config: OCRConfig): string {
  const normalized = value.replace(/\s+/g, "");
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1) {
    throw new OCRRequestError(provider, "OCR image base64 is invalid");
  }
  const maxBytes = config.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("OCR maxImageBytes must be a positive safe integer");
  }
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  const decodedBytes = Math.floor((normalized.length * 3) / 4) - padding;
  if (decodedBytes > maxBytes) {
    throw new OCRRequestError(provider, `OCR image exceeds maxImageBytes=${maxBytes}`);
  }
  return normalized;
}
