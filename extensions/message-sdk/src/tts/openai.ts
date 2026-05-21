/**
 * OpenAI TTS 语音合成
 *
 * 基于 OpenAI TTS API（tts-1 / tts-1-hd），支持 6 种内置语音。
 * 需要 OpenAI API Key。
 * 参考：llm-study/llm-text-to-speech/openai/ + llm-text-to-speech Claude.md
 */

import {
  TTSError, TTSTimeoutError, TTSAuthError, TTSRequestError, TTSResponseParseError, TTSServiceError, TTSEmptyResultError,
} from "./errors.js";
import type { TTSConfig, TTSResult } from "./types.js";

const PROVIDER = "openai";
const DEFAULT_MODEL = "tts-1";
const DEFAULT_VOICE = "alloy";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

const VALID_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;
const VALID_FORMATS = ["mp3", "opus", "aac", "flac", "wav", "pcm"] as const;

type VoiceName = (typeof VALID_VOICES)[number];
type OutputFormat = (typeof VALID_FORMATS)[number];

function resolveVoice(voice?: string): VoiceName {
  if (voice && VALID_VOICES.includes(voice as VoiceName)) {
    return voice as VoiceName;
  }
  return DEFAULT_VOICE;
}

function resolveFormat(format?: string): OutputFormat {
  if (format && VALID_FORMATS.includes(format as OutputFormat)) {
    return format as OutputFormat;
  }
  return "mp3";
}

/**
 * OpenAI TTS 语音合成
 *
 * 语音说明：
 *   alloy  - 中性、通用
 *   echo   - 温暖、深沉
 *   fable  - 英式、叙述
 *   onyx   - 深沉、权威感
 *   nova   - 温暖、亲和
 *   shimmer - 清晰、自信
 *
 * 模型：tts-1（标准）/ tts-1-hd（高保真）
 */
export async function synthesizeOpenAI(
  text: string,
  config: TTSConfig,
): Promise<TTSResult> {
  const maxLen = config.maxTextLength ?? 4096;
  if (text.length > maxLen) {
    throw new TTSRequestError(PROVIDER, `Text too long: ${text.length} > ${maxLen} chars`);
  }

  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const model = config.model || DEFAULT_MODEL;
  const voice = resolveVoice(config.voice);
  const format = resolveFormat(config.outputFormat);
  const timeoutMs = config.timeoutMs ?? 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startMs = Date.now();

  try {
    const resp = await fetch(`${baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: text,
        voice,
        response_format: format,
        speed: config.rate ? 1 + parseInt(config.rate) / 100 : 1,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      if (resp.status === 401 || resp.status === 403) {
        throw new TTSAuthError(PROVIDER, `OpenAI auth failed: ${errText}`, resp.status);
      }
      throw new TTSRequestError(PROVIDER, `OpenAI TTS failed: HTTP ${resp.status} ${errText}`, resp.status);
    }

    const audio = Buffer.from(await resp.arrayBuffer());
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
