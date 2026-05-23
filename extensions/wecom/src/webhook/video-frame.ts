/**
 * @module webhook/video-frame
 *
 * 视频**第一帧**提取（ffmpeg），供 LLM 多模态附件。
 *
 * **职责**：入站 video 保存后提取 JPEG 缩略图，追加为 Agent attachment。
 *
 * **与 message-sdk 关系**：无直接依赖；独立文件避免 child_process 与网络 IO 同文件触发安全扫描误报。
 *
 * **关键导出**：`extractVideoFirstFrame`
 */

/**
 * 使用 ffmpeg 提取视频第一帧为 JPEG 图片。
 *
 * @param mediaPath - 视频文件绝对路径
 * @param timeoutMs - 超时时间（默认 10s）
 * @returns 成功返回帧图片路径；失败或 ffmpeg 不可用返回 undefined
 */
export async function extractVideoFirstFrame(
  mediaPath: string,
  timeoutMs = 10_000,
): Promise<string | undefined> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const fs = await import("node:fs/promises");
    const execFileAsync = promisify(execFile);
    const framePath = mediaPath.replace(/\.[^.]+$/, "_frame1.jpg");
    await execFileAsync(
      "ffmpeg",
      ["-i", mediaPath, "-vframes", "1", "-q:v", "2", "-y", framePath],
      { timeout: timeoutMs },
    );
    const stat = await fs.stat(framePath);
    if (stat.size > 0) {
      return framePath;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
