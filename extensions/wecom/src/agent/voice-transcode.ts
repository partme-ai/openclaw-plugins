/**
 * @module agent/voice-transcode
 *
 * Agent 模式 **语音转 AMR**（企微 voice 消息仅原生支持 AMR/SPEEX）。
 *
 * **职责**：
 * - 检测 ffmpeg 是否可用
 * - 将 mp3/wav 等格式 transcoding 为 8kHz mono AMR
 * - 供 `api-client.uploadMedia` 在 type=voice 时调用
 *
 * 来源：wecom-app voice transcoding 实现。
 */

import { spawn } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * 检测系统是否安装 ffmpeg。
 */
export async function hasFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
    p.on("error", () => resolve(false));
    p.on("exit", (code) => resolve(code === 0));
  });
}

/**
 * 将本地音频文件 transcoding 为 AMR（8kHz 单声道）。
 *
 * @param inputPath - 输入文件路径
 * @param outputPath - 输出 .amr 路径
 */
export async function transcodeToAmr(inputPath: string, outputPath: string): Promise<void> {
  const args = [
    "-y",
    "-i", inputPath,
    "-ar", "8000",
    "-ac", "1",
    "-c:a", "amr_nb",
    outputPath
  ];

  await new Promise<void>((resolve, reject) => {
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr?.on("data", (d) => (err += String(d)));
    p.on("error", (e) => reject(e));
    p.on("exit", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg transcode failed (code=${code}): ${err.slice(0, 2000)}`));
    });
  });
}

/**
 * 将内存中的音频 Buffer transcoding 为 AMR Buffer。
 *
 * @param audioBuffer - 原始音频
 * @param inputFormat - 扩展名/格式（如 mp3、wav）
 */
export async function transcodeBufferToAmr(
  audioBuffer: Buffer,
  inputFormat: string
): Promise<Buffer> {
  const canTranscode = await hasFfmpeg();
  if (!canTranscode) {
    throw new Error("ffmpeg is unavailable for voice transcoding");
  }

  const tempDir = await mkdtemp(join(tmpdir(), "wecom-voice-"));
  const inputPath = join(tempDir, `input.${inputFormat}`);
  const outputPath = join(tempDir, "output.amr");

  try {
    await writeFile(inputPath, audioBuffer);
    await transcodeToAmr(inputPath, outputPath);
    const amrBuffer = await readFile(outputPath);
    return amrBuffer;
  } finally {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响主流程
    }
  }
}

/** 企微原生支持的语音容器格式 */
export const WECOM_VOICE_FORMATS = ["amr", "speex"];

/**
 * 判断格式是否企微原生支持（无需转码）。
 *
 * @param format - 扩展名
 */
export function isWecomNativeVoiceFormat(format: string): boolean {
  return WECOM_VOICE_FORMATS.includes(format.toLowerCase());
}

/**
 * 判断上传前是否需要 ffmpeg 转 AMR。
 *
 * @param format - 扩展名
 */
export function needsTranscoding(format: string): boolean {
  return !isWecomNativeVoiceFormat(format);
}
