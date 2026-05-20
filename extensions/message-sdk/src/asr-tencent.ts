/**
 * 腾讯云 Flash ASR（语音识别）
 *
 * 来源：openclaw-china packages/shared/src/asr/
 * 适配为独立模块，不依赖 openclaw-china/shared。
 */

import { createHmac } from "node:crypto";

// ============================================================================
// 错误类型
// ============================================================================

export type ASRErrorKind = "timeout" | "auth" | "request" | "response_parse" | "service" | "empty_result";

export class ASRError extends Error {
  constructor(message: string, public readonly kind: ASRErrorKind, public readonly provider: string, public readonly retryable = false) {
    super(message);
    this.name = "ASRError";
  }
}

export class ASRTimeoutError extends ASRError {
  constructor(provider: string, public readonly timeoutMs: number) {
    super(`ASR timeout after ${timeoutMs}ms`, "timeout", provider, true);
    this.name = "ASRTimeoutError";
  }
}

export class ASRAuthError extends ASRError {
  constructor(provider: string, message: string, public readonly status?: number) {
    super(message, "auth", provider, false);
    this.name = "ASRAuthError";
  }
}

export class ASRRequestError extends ASRError {
  constructor(provider: string, message: string, public readonly status?: number) {
    super(message, "request", provider, true);
    this.name = "ASRRequestError";
  }
}

export class ASRResponseParseError extends ASRError {
  constructor(provider: string, public readonly bodySnippet: string) {
    super("ASR response is not valid JSON", "response_parse", provider, false);
    this.name = "ASRResponseParseError";
  }
}

export class ASRServiceError extends ASRError {
  constructor(provider: string, message: string, public readonly serviceCode?: number) {
    super(message, "service", provider, false);
    this.name = "ASRServiceError";
  }
}

export class ASREmptyResultError extends ASRError {
  constructor(provider: string) {
    super("ASR returned empty transcript", "empty_result", provider, false);
    this.name = "ASREmptyResultError";
  }
}

// ============================================================================
// 腾讯云 Flash ASR
// ============================================================================

const ASR_FLASH_HOST = "asr.cloud.tencent.com";
const ASR_FLASH_PATH_PREFIX = "/asr/flash/v1";
const ASR_FLASH_URL_PREFIX = `https://${ASR_FLASH_HOST}${ASR_FLASH_PATH_PREFIX}`;
const ASR_PROVIDER = "tencent-flash";

export interface TencentFlashASRConfig {
  appId: string;
  secretId: string;
  secretKey: string;
  engineType?: string;
  voiceFormat?: string;
  timeoutMs?: number;
}

function encodeQueryValue(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+").replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildSignedQuery(params: Record<string, string>): string {
  return Object.entries(params).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeQueryValue(v)}`).join("&");
}

function extractTranscript(payload: { code?: number; message?: string; flash_result?: Array<{ text?: string; sentence_list?: Array<{ text?: string }> }> }): string {
  const items = Array.isArray(payload.flash_result) ? payload.flash_result : [];
  const lines: string[] = [];
  for (const item of items) {
    if (typeof item?.text === "string" && item.text.trim()) { lines.push(item.text.trim()); continue; }
    for (const s of Array.isArray(item?.sentence_list) ? item.sentence_list : []) {
      if (typeof s?.text === "string" && s.text.trim()) lines.push(s.text.trim());
    }
  }
  return lines.join("\n").trim();
}

export async function transcribeTencentFlash(params: { audio: Buffer; config: TencentFlashASRConfig }): Promise<string> {
  const { audio, config } = params;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const engineType = config.engineType ?? "16k_zh";
  const voiceFormat = config.voiceFormat ?? "silk";
  const query = buildSignedQuery({ engine_type: engineType, secretid: config.secretId, timestamp, voice_format: voiceFormat });
  const signText = `POST${ASR_FLASH_HOST}${ASR_FLASH_PATH_PREFIX}/${config.appId}?${query}`;
  const authorization = createHmac("sha1", config.secretKey).update(signText).digest("base64");
  const url = `${ASR_FLASH_URL_PREFIX}/${config.appId}?${query}`;
  const timeoutMs = config.timeoutMs ?? 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, { method: "POST", headers: { Authorization: authorization, "Content-Type": "application/octet-stream" }, body: audio, signal: controller.signal });
    const bodyText = await resp.text();
    let payload: { code?: number; message?: string; flash_result?: Array<{ text?: string; sentence_list?: Array<{ text?: string }> }> };
    try { payload = JSON.parse(bodyText); } catch { throw new ASRResponseParseError(ASR_PROVIDER, bodyText.slice(0, 300)); }
    if (!resp.ok) {
      const msg = payload.message ?? `HTTP ${resp.status}`;
      if (resp.status === 401 || resp.status === 403) throw new ASRAuthError(ASR_PROVIDER, `Tencent Flash ASR auth failed: ${msg}`, resp.status);
      throw new ASRRequestError(ASR_PROVIDER, `Tencent Flash ASR request failed: ${msg}`, resp.status);
    }
    if (payload.code !== 0) throw new ASRServiceError(ASR_PROVIDER, `Tencent Flash ASR failed: ${payload.message ?? "unknown"} (code=${payload.code})`, payload.code);
    const transcript = extractTranscript(payload);
    if (!transcript) throw new ASREmptyResultError(ASR_PROVIDER);
    return transcript;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new ASRTimeoutError(ASR_PROVIDER, timeoutMs);
    if (err instanceof ASRError) throw err;
    throw new ASRRequestError(ASR_PROVIDER, `ASR request failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally { clearTimeout(timeoutId); }
}
