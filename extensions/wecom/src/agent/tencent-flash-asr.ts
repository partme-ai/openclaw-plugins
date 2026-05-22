/**
 * 腾讯云 Flash ASR（WeCom Agent 语音转写，独立于 message-sdk）。
 */

import { createHmac } from "node:crypto";

const ASR_FLASH_HOST = "asr.cloud.tencent.com";
const ASR_FLASH_PATH_PREFIX = "/asr/flash/v1";
const ASR_FLASH_URL_PREFIX = `https://${ASR_FLASH_HOST}${ASR_FLASH_PATH_PREFIX}`;

export interface TencentFlashASRConfig {
  appId: string;
  secretId: string;
  secretKey: string;
  engineType?: string;
  voiceFormat?: string;
  timeoutMs?: number;
}

function encodeQueryValue(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildSignedQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeQueryValue(value)}`)
    .join("&");
}

function extractTranscript(payload: {
  flash_result?: Array<{ text?: string; sentence_list?: Array<{ text?: string }> }>;
}): string {
  const items = Array.isArray(payload.flash_result) ? payload.flash_result : [];
  const lines: string[] = [];
  for (const item of items) {
    if (typeof item?.text === "string" && item.text.trim()) {
      lines.push(item.text.trim());
      continue;
    }
    for (const sentence of item?.sentence_list ?? []) {
      if (typeof sentence?.text === "string" && sentence.text.trim()) {
        lines.push(sentence.text.trim());
      }
    }
  }
  return lines.join("\n").trim();
}

/** 调用腾讯云 Flash ASR 转写音频 */
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
    let payload: { code?: number; message?: string; flash_result?: unknown[] };
    try {
      payload = JSON.parse(bodyText) as typeof payload;
    } catch {
      throw new Error(`Tencent Flash ASR invalid JSON: ${bodyText.slice(0, 300)}`);
    }

    if (!response.ok) {
      throw new Error(`Tencent Flash ASR HTTP ${response.status}: ${payload.message ?? bodyText}`);
    }
    if (payload.code !== 0) {
      throw new Error(
        `Tencent Flash ASR failed: ${payload.message ?? "unknown"} (code=${payload.code})`,
      );
    }

    const transcript = extractTranscript(
      payload as Parameters<typeof extractTranscript>[0],
    );
    if (!transcript) {
      throw new Error("Tencent Flash ASR returned empty transcript");
    }
    return transcript;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Tencent Flash ASR timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
