/**
 * @module file/text-heuristic
 *
 * 文本文件启发式检测与预览（入站媒体场景共用）。
 *
 * **职责**：判断 Buffer 是否像文本、生成截断预览、规范化 text/markdown MIME。
 *
 * **关键导出**：`looksLikeTextFile`、`analyzeTextHeuristic`、`buildTextFilePreview`、
 * `previewHex`、`normalizeInboundTextContentType`
 */

import path from "node:path";

/**
 * 判断 Buffer 样本是否像 UTF-8 文本（非可打印字符占比 ≤ 2%）。
 */
export function looksLikeTextFile(buffer: Buffer): boolean {
  const sampleSize = Math.min(buffer.length, 4096);
  if (sampleSize === 0) return true;
  let bad = 0;
  for (let i = 0; i < sampleSize; i++) {
    const b = buffer[i]!;
    const isWhitespace = b === 0x09 || b === 0x0a || b === 0x0d;
    const isPrintable = b >= 0x20 && b !== 0x7f;
    if (!isWhitespace && !isPrintable) bad++;
  }
  return bad / sampleSize <= 0.02;
}

/**
 * 分析 Buffer 文本启发式指标（用于日志/诊断）。
 */
export function analyzeTextHeuristic(buffer: Buffer): {
  sampleSize: number;
  badCount: number;
  badRatio: number;
} {
  const sampleSize = Math.min(buffer.length, 4096);
  if (sampleSize === 0) return { sampleSize: 0, badCount: 0, badRatio: 0 };
  let badCount = 0;
  for (let i = 0; i < sampleSize; i++) {
    const b = buffer[i]!;
    const isWhitespace = b === 0x09 || b === 0x0a || b === 0x0d;
    const isPrintable = b >= 0x20 && b !== 0x7f;
    if (!isWhitespace && !isPrintable) badCount++;
  }
  return { sampleSize, badCount, badRatio: badCount / sampleSize };
}

/**
 * 将 Buffer 前若干字节格式化为十六进制预览（日志用）。
 */
export function previewHex(buffer: Buffer, maxBytes = 32): string {
  const n = Math.min(buffer.length, maxBytes);
  if (n <= 0) return "";
  return buffer
    .subarray(0, n)
    .toString("hex")
    .replace(/(..)/g, "$1 ")
    .trim();
}

/**
 * 若 Buffer 像文本则返回 UTF-8 预览（超长截断）。
 */
export function buildTextFilePreview(buffer: Buffer, maxChars: number): string | undefined {
  if (!looksLikeTextFile(buffer)) return undefined;
  const text = buffer.toString("utf8");
  if (!text.trim()) return undefined;
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…(已截断)` : text;
}

/**
 * 入站媒体 MIME 规范化：文本/Markdown 文件推断 content-type。
 */
export function normalizeInboundTextContentType(params: {
  contentType: string;
  originalFileName: string;
  looksText: boolean;
}): string {
  const { contentType, originalFileName, looksText } = params;
  const originalExt = path.extname(originalFileName).toLowerCase();
  if (looksText && originalExt === ".md") return "text/markdown";
  if (looksText && (!contentType || contentType === "application/octet-stream")) {
    return "text/plain; charset=utf-8";
  }
  return contentType;
}
