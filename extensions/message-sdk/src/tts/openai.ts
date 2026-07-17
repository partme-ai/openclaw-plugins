/**
 * @module tts/openai
 *
 * OpenAI TTS 语音合成 — 对齐 `/audio/speech` 的模型、语音、格式与 speed 契约。
 *
 * **参考**：llm-study/llm-text-to-speech/openai/
 *
 * **关键导出**：`synthesizeOpenAI`
 */

import {
  TTSError, TTSTimeoutError, TTSAuthError, TTSRequestError, TTSResponseParseError, TTSServiceError, TTSEmptyResultError,
} from "./errors.js";
import type { TTSConfig, TTSResult } from "./types.js";

const PROVIDER = "openai";
const DEFAULT_MODEL = "tts-1";
const DEFAULT_VOICE = "alloy";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

const VALID_VOICES = [
  "alloy", "ash", "ballad", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer",
  "verse", "marin", "cedar",
] as const;
const VALID_FORMATS = ["mp3", "opus", "aac", "flac", "wav", "pcm"] as const;

type VoiceName = (typeof VALID_VOICES)[number];
type OutputFormat = (typeof VALID_FORMATS)[number];

function resolveVoice(voice?: string): VoiceName {
  if (!voice) return DEFAULT_VOICE;
  if (VALID_VOICES.includes(voice as VoiceName)) return voice as VoiceName;
  throw new TTSRequestError(PROVIDER, `Unsupported OpenAI voice: ${voice}`);
}

function resolveFormat(format?: string): OutputFormat {
  if (!format) return "mp3";
  if (VALID_FORMATS.includes(format as OutputFormat)) return format as OutputFormat;
  throw new TTSRequestError(PROVIDER, `Unsupported OpenAI response format: ${format}`);
}

function resolveSpeed(rate?: string): number {
  if (!rate?.trim()) return 1;
  const normalized = rate.trim().replace(/%$/, "");
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) {
    throw new TTSRequestError(PROVIDER, `Invalid OpenAI speech rate: ${rate}`);
  }
  const speed = 1 + Number(normalized) / 100;
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) {
    throw new TTSRequestError(PROVIDER, `OpenAI speech speed must be between 0.25 and 4.0: ${speed}`);
  }
  return speed;
}

/** 流式读取音频并在累计过程中执行上限，避免超大响应先完整分配内存。 */
async function readAudioWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new TTSRequestError(PROVIDER, `OpenAI TTS response exceeds maxAudioBytes=${maxBytes}`);
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new TTSRequestError(PROVIDER, `OpenAI TTS response exceeds maxAudioBytes=${maxBytes}`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

/** 错误响应只保留 4 KiB 诊断片段，防止异常正文绕过正常音频上限。 */
async function readErrorSnippet(response: Response, maxBytes = 4096): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value).subarray(0, maxBytes - total);
      chunks.push(chunk);
      total += chunk.length;
      if (chunk.length < value.byteLength || total >= maxBytes) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

/**
 * 调用 OpenAI `/audio/speech` 将文本合成为音频。
 *
 * 语音：alloy / echo / fable / onyx / nova / shimmer
 * 模型：tts-1（标准）或 tts-1-hd（高保真）
 *
 * @param text - 待合成文本（长度受 `config.maxTextLength` 限制）
 * @param config - API 密钥、模型、语音与输出格式
 * @returns 音频 Buffer 与元数据
 * @throws {@link TTSAuthError} {@link TTSEmptyResultError} 等
 *
 * @example
 * ```ts
 * const { audio } = await synthesizeOpenAI("你好", {
 *   apiKey: process.env.OPENAI_API_KEY!,
 *   voice: "nova",
 * });
 * ```
 */
export async function synthesizeOpenAI(
  text: string,
  config: TTSConfig,
): Promise<TTSResult> {
  if (typeof text !== "string" || !text.trim()) {
    throw new TTSRequestError(PROVIDER, "OpenAI TTS text must be non-empty");
  }
  const configuredMaxLen = config.maxTextLength ?? 4096;
  if (!Number.isSafeInteger(configuredMaxLen) || configuredMaxLen <= 0) {
    throw new RangeError("OpenAI TTS maxTextLength must be a positive safe integer");
  }
  // OpenAI 官方上限固定为 4096；本地配置只能进一步收紧，不能放宽服务端契约。
  const maxLen = Math.min(configuredMaxLen, 4096);
  if (text.length > maxLen) {
    throw new TTSRequestError(PROVIDER, `Text too long: ${text.length} > ${maxLen} chars`);
  }

  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const model = config.model || DEFAULT_MODEL;
  const voice = resolveVoice(config.voice);
  const format = resolveFormat(config.outputFormat);
  const speed = resolveSpeed(config.rate);
  const timeoutMs = config.timeoutMs ?? 30000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("OpenAI TTS timeoutMs must be a positive safe integer");
  }
  const maxAudioBytes = config.maxAudioBytes ?? 25 * 1024 * 1024;
  if (!Number.isSafeInteger(maxAudioBytes) || maxAudioBytes <= 0) {
    throw new RangeError("OpenAI TTS maxAudioBytes must be a positive safe integer");
  }
  if (typeof config.apiKey !== "string" || !config.apiKey.trim()) {
    throw new TTSAuthError(PROVIDER, "OpenAI TTS apiKey is required");
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startMs = Date.now();

  try {
    const resp = await fetch(`${baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model,
        input: text,
        voice,
        response_format: format,
        speed,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errText = await readErrorSnippet(resp).catch(() => "");
      if (resp.status === 401 || resp.status === 403) {
        throw new TTSAuthError(PROVIDER, `OpenAI auth failed: ${errText}`, resp.status);
      }
      throw new TTSRequestError(PROVIDER, `OpenAI TTS failed: HTTP ${resp.status} ${errText}`, resp.status);
    }

    const audio = await readAudioWithLimit(resp, maxAudioBytes);
    if (audio.length === 0) throw new TTSEmptyResultError(PROVIDER);

    return {
      audio,
      format: format === "pcm" ? "pcm" : format,
      provider: PROVIDER,
      voice,
      elapsedMs: Date.now() - startMs,
    };
  } catch (err: unknown) {
    if (err instanceof TTSError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new TTSTimeoutError(PROVIDER, timeoutMs);
    }
    throw new TTSRequestError(PROVIDER, `OpenAI TTS request failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timeoutId);
  }
}
