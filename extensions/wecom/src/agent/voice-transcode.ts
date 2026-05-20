/**
 * Voice Transcoding - Agent Mode Capability
 *
 * Transcodes audio to AMR format for WeCom compatibility
 * Uses ffmpeg for audio conversion
 *
 * Source: wecom-app voice transcoding
 */

import { spawn } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Check if ffmpeg is available
 * @returns true if ffmpeg command exists
 */
export async function hasFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
    p.on("error", () => resolve(false));
    p.on("exit", (code) => resolve(code === 0));
  });
}

/**
 * Transcode audio to AMR format (8kHz mono) for WeCom
 * @param inputPath - Input audio file path
 * @param outputPath - Output AMR file path
 */
export async function transcodeToAmr(inputPath: string, outputPath: string): Promise<void> {
  // amr_nb requires 8kHz mono for most WeCom clients
  const args = [
    "-y", // Overwrite output file
    "-i", inputPath,
    "-ar", "8000", // 8kHz sample rate
    "-ac", "1", // Mono
    "-c:a", "amr_nb", // AMR narrowband codec
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
 * Transcode audio buffer to AMR format
 * @param audioBuffer - Input audio buffer
 * @param inputFormat - Input format (e.g., "mp3", "wav")
 * @returns AMR format audio buffer
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
    // Write input file
    await writeFile(inputPath, audioBuffer);

    // Transcode
    await transcodeToAmr(inputPath, outputPath);

    // Read output
    const amrBuffer = await readFile(outputPath);
    return amrBuffer;
  } finally {
    // Cleanup temp directory
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * WeCom supported voice formats
 */
export const WECOM_VOICE_FORMATS = ["amr", "speex"];

/**
 * Check if audio format is natively supported by WeCom
 * @param format - Audio format (e.g., "amr", "mp3")
 * @returns true if WeCom natively supports this format
 */
export function isWecomNativeVoiceFormat(format: string): boolean {
  return WECOM_VOICE_FORMATS.includes(format.toLowerCase());
}

/**
 * Check if audio needs transcoding for WeCom
 * @param format - Audio format
 * @returns true if transcoding is needed
 */
export function needsTranscoding(format: string): boolean {
  return !isWecomNativeVoiceFormat(format);
}
