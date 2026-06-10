/**
 * @module tts/edge-tts
 *
 * Microsoft Edge TTS — 通过 `edge-tts` Python CLI 免费合成神经语音。
 *
 * **安装**：`pip install edge-tts`
 *
 * **关键导出**：`synthesizeEdgeTTS`、`EDGE_TTS_VOICES`
 */

import { execFile } from "node:child_process";
import { readFile, unlink, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import {
  TTSError,
  TTSTimeoutError,
  TTSRequestError,
  TTSEmptyResultError,
} from "./errors.js";
import type { TTSConfig, TTSResult, TTSVoice } from "./types.js";

const PROVIDER = "edge-tts";
const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";

function buildArgs(text: string, config: TTSConfig): string[] {
  const args: string[] = [];
  args.push("--text", text);
  args.push("--voice", config.voice ?? DEFAULT_VOICE);
  if (config.rate) args.push("--rate", config.rate);
  if (config.volume) args.push("--volume", config.volume);
  if (config.pitch) args.push("--pitch", config.pitch);
  return args;
}

/**
 * 通过 edge-tts CLI 合成语音（输出 MP3 临时文件后读入 Buffer）。
 *
 * @param text - 待合成文本
 * @param config - 语音、语速/音量/音调与超时
 * @returns MP3 音频 Buffer
 * @throws CLI 未安装或超时时 {@link TTSRequestError} / {@link TTSTimeoutError}
 *
 * @example
 * ```ts
 * const { audio } = await synthesizeEdgeTTS("你好", { voice: "zh-CN-XiaoxiaoNeural" });
 * ```
 */
export async function synthesizeEdgeTTS(
  text: string,
  config: TTSConfig = {},
): Promise<TTSResult> {
  const maxLen = config.maxTextLength ?? 4096;
  if (text.length > maxLen) {
    throw new TTSRequestError(PROVIDER, `Text too long: ${text.length} > ${maxLen} chars`);
  }

  const timeoutMs = config.timeoutMs ?? 30000;
  const startMs = Date.now();
  const tmpDir = await mkdtemp(join(tmpdir(), "tts-edge-"));
  const outputFile = join(tmpDir, `tts-${randomBytes(4).toString("hex")}.mp3`);

  try {
    const args = buildArgs(text, config);
    args.push("--write-media", outputFile);

    await new Promise<void>((resolve, reject) => {
      const child = execFile("edge-tts", args, { timeout: timeoutMs }, (err) => {
        if (err) reject(err);
        else resolve();
      });
      // Suppress stdout/stderr noise from Python
      child.stdout?.on("data", () => {});
      child.stderr?.on("data", () => {});
    });

    const audio = await readFile(outputFile);
    if (audio.length === 0) throw new TTSEmptyResultError(PROVIDER);

    return {
      audio,
      format: "mp3",
      provider: PROVIDER,
      voice: config.voice ?? DEFAULT_VOICE,
      elapsedMs: Date.now() - startMs,
    };
  } catch (err: unknown) {
    if (err instanceof TTSError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("killed") || msg.includes("ETIMEDOUT")) {
      throw new TTSTimeoutError(PROVIDER, timeoutMs);
    }
    throw new TTSRequestError(PROVIDER, `edge-tts failed: ${msg}. Install with: pip install edge-tts`);
  } finally {
    try { await unlink(outputFile); } catch { /* cleanup */ }
    try { await (await import("node:fs/promises")).rmdir(tmpDir); } catch { /* cleanup */ }
  }
}

/**
 * Edge TTS 常用中文语音列表（UI 选型参考）。
 *
 * 完整列表：`edge-tts --list-voices`
 */
export const EDGE_TTS_VOICES: TTSVoice[] = [
  { shortName: "zh-CN-XiaoxiaoNeural", locale: "zh-CN", gender: "Female", friendlyName: "小小（活泼）" },
  { shortName: "zh-CN-XiaoyiNeural", locale: "zh-CN", gender: "Female", friendlyName: "小艺（温柔）" },
  { shortName: "zh-CN-YunxiNeural", locale: "zh-CN", gender: "Male", friendlyName: "云希（新闻）" },
  { shortName: "zh-CN-YunyangNeural", locale: "zh-CN", gender: "Male", friendlyName: "云杨（专业）" },
  { shortName: "zh-CN-YunjianNeural", locale: "zh-CN", gender: "Male", friendlyName: "云健（运动）" },
  { shortName: "zh-CN-XiaochenNeural", locale: "zh-CN", gender: "Female", friendlyName: "晓辰（自然）" },
  { shortName: "zh-CN-XiaohanNeural", locale: "zh-CN", gender: "Female", friendlyName: "晓涵（知性）" },
  { shortName: "zh-CN-liaoning-XiaobeiNeural", locale: "zh-CN-liaoning", gender: "Female", friendlyName: "小北（东北话）" },
  { shortName: "zh-CN-shaanxi-XiaoniNeural", locale: "zh-CN-shaanxi", gender: "Female", friendlyName: "小妮（陕西话）" },
  { shortName: "zh-HK-HiuMaanNeural", locale: "zh-HK", gender: "Female", friendlyName: "晓曼（粤语）" },
  { shortName: "zh-TW-HsiaoChenNeural", locale: "zh-TW", gender: "Female", friendlyName: "小辰（台湾）" },
];
