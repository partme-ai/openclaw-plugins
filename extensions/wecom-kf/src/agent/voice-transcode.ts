/**
 * @module agent/voice-transcode
 *
 * KF 出站语音转 AMR（企微 voice 消息原生支持 AMR/SPEEX）。
 * 逻辑与 extensions/wecom 对齐，但不跨扩展 import。
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** 企微原生支持的语音容器格式 */
export const WECOM_VOICE_FORMATS = ["amr", "speex"] as const;

/**
 * 检测系统是否安装 ffmpeg。
 */
export async function hasFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
    proc.on("error", () => resolve(false));
    proc.on("exit", (code) => resolve(code === 0));
  });
}

/**
 * 将本地音频文件 transcoding 为 AMR（8kHz 单声道）。
 */
export async function transcodeToAmr(inputPath: string, outputPath: string): Promise<void> {
  const args = ["-y", "-i", inputPath, "-ar", "8000", "-ac", "1", "-c:a", "amr_nb", outputPath];

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    proc.stderr?.on("data", (chunk) => {
      err += String(chunk);
    });
    proc.on("error", (error) => reject(error));
    proc.on("exit", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg transcode failed (code=${code}): ${err.slice(0, 2000)}`));
    });
  });
}

/**
 * 将内存中的音频 Buffer transcoding 为 AMR Buffer。
 */
export async function transcodeBufferToAmr(audioBuffer: Buffer, inputFormat: string): Promise<Buffer> {
  const canTranscode = await hasFfmpeg();
  if (!canTranscode) {
    throw new Error("ffmpeg is unavailable for voice transcoding");
  }

  const tempDir = await mkdtemp(join(tmpdir(), "wecom-kf-voice-"));
  const inputPath = join(tempDir, `input.${inputFormat}`);
  const outputPath = join(tempDir, "output.amr");

  try {
    await writeFile(inputPath, audioBuffer);
    await transcodeToAmr(inputPath, outputPath);
    return await readFile(outputPath);
  } finally {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响主流程
    }
  }
}

/**
 * 判断格式是否企微原生支持（无需转码）。
 */
export function isWecomNativeVoiceFormat(format: string): boolean {
  return WECOM_VOICE_FORMATS.includes(format.toLowerCase() as (typeof WECOM_VOICE_FORMATS)[number]);
}

/**
 * 判断上传前是否需要 ffmpeg 转 AMR。
 */
export function needsTranscoding(format: string): boolean {
  return !isWecomNativeVoiceFormat(format);
}
