/**
 * @module asr/tencent-flash
 *
 * 腾讯云 Flash ASR（一句话识别 / Flash ASR）。
 *
 * **职责**：将音频 Buffer 提交腾讯云 Flash 接口并返回合并后的文本转写。
 *
 * **来源**：openclaw-china packages/shared/src/asr/tencent-flash.ts (MIT License)
 *
 * **关键导出**：`transcribeTencentFlash`、`TencentFlashASRConfig`
 */

import { createHmac } from "node:crypto";
import {
  ASRAuthError,
  ASREmptyResultError,
  ASRError,
  ASRRequestError,
  ASRResponseParseError,
  ASRServiceError,
  ASRTimeoutError,
} from "./errors.js";

const ASR_FLASH_HOST = "asr.cloud.tencent.com";
const ASR_FLASH_PATH_PREFIX = "/asr/flash/v1";
const ASR_FLASH_URL_PREFIX = `https://${ASR_FLASH_HOST}${ASR_FLASH_PATH_PREFIX}`;
const ASR_PROVIDER = "tencent-flash";

/**
 * 腾讯云 Flash ASR 配置 / Tencent Flash ASR credentials and options.
 *
 * @property appId - 腾讯云应用 ID
 * @property secretId - API SecretId
 * @property secretKey - API SecretKey（用于 HMAC-SHA1 签名）
 * @property engineType - 引擎类型（默认 `16k_zh`）
 * @property voiceFormat - 音频格式（默认 `silk`）
 * @property timeoutMs - 请求超时（默认 30000）
 */
export interface TencentFlashASRConfig {
  appId: string;
  secretId: string;
  secretKey: string;
  engineType?: string;
  voiceFormat?: string;
  timeoutMs?: number;
}

interface TencentFlashResponseSentence {
  text?: string;
}

interface TencentFlashResponseItem {
  text?: string;
  sentence_list?: TencentFlashResponseSentence[];
}

interface TencentFlashResponse {
  code?: number;
  message?: string;
  flash_result?: TencentFlashResponseItem[];
}

/** URL 查询参数值编码（腾讯云签名规范） */
function encodeQueryValue(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** 按 key 排序并拼接 signed query string */
function buildSignedQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeQueryValue(value)}`)
    .join("&");
}

/** 从 flash_result 提取合并文本（优先 item.text，否则拼接 sentence_list） */
function extractTranscript(payload: TencentFlashResponse): string {
  const items = Array.isArray(payload.flash_result) ? payload.flash_result : [];
  const lines: string[] = [];

  for (const item of items) {
    if (typeof item?.text === "string" && item.text.trim()) {
      lines.push(item.text.trim());
      continue;
    }
    const sentenceList = Array.isArray(item?.sentence_list) ? item.sentence_list : [];
    for (const sentence of sentenceList) {
      if (typeof sentence?.text === "string" && sentence.text.trim()) {
        lines.push(sentence.text.trim());
      }
    }
  }

  return lines.join("\n").trim();
}

/**
 * 调用腾讯云 Flash ASR 将音频转为文本。
 *
 * @param params.audio - 原始音频二进制
 * @param params.config - 腾讯云凭证与引擎配置
 * @returns 合并后的转写文本
 * @throws {@link ASRAuthError} {@link ASRTimeoutError} {@link ASREmptyResultError} 等
 *
 * @example
 * ```ts
 * const text = await transcribeTencentFlash({
 *   audio: silkBuffer,
 *   config: { appId: "...", secretId: "...", secretKey: "..." },
 * });
 * ```
 */
export async function transcribeTencentFlash(params: {
  audio: Buffer;
  config: TencentFlashASRConfig;
}): Promise<string> {
  const { audio, config } = params;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const engineType = config.engineType ?? "16k_zh";
  const voiceFormat = config.voiceFormat ?? "silk";
  const query = buildSignedQuery({
    engine_type: engineType,
    secretid: config.secretId,
    timestamp,
    voice_format: voiceFormat,
  });

  const signText = `POST${ASR_FLASH_HOST}${ASR_FLASH_PATH_PREFIX}/${config.appId}?${query}`;
  const authorization = createHmac("sha1", config.secretKey).update(signText).digest("base64");
  const url = `${ASR_FLASH_URL_PREFIX}/${config.appId}?${query}`;
  const timeoutMs = config.timeoutMs ?? 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/octet-stream",
      },
      body: audio,
      signal: controller.signal,
    });

    const bodyText = await response.text();
    let payload: TencentFlashResponse;
    try {
      payload = JSON.parse(bodyText) as TencentFlashResponse;
    } catch {
      throw new ASRResponseParseError(ASR_PROVIDER, bodyText.slice(0, 300));
    }

    if (!response.ok) {
      const message = payload.message ?? `HTTP ${response.status}`;
      if (response.status === 401 || response.status === 403) {
        throw new ASRAuthError(
          ASR_PROVIDER,
          `Tencent Flash ASR authentication failed: ${message}`,
          response.status,
        );
      }
      throw new ASRRequestError(
        ASR_PROVIDER,
        `Tencent Flash ASR request failed: ${message}`,
        response.status,
      );
    }

    if (payload.code !== 0) {
      throw new ASRServiceError(
        ASR_PROVIDER,
        `Tencent Flash ASR failed: ${payload.message ?? "unknown error"} (code=${payload.code})`,
        payload.code,
      );
    }

    const transcript = extractTranscript(payload);
    if (!transcript) {
      throw new ASREmptyResultError(ASR_PROVIDER);
    }
    return transcript;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ASRTimeoutError(ASR_PROVIDER, timeoutMs);
    }
    if (error instanceof ASRError) {
      throw error;
    }
    throw new ASRRequestError(
      ASR_PROVIDER,
      `Tencent Flash ASR request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
