/**
 * @fileoverview 文档切分器 — 将长文本拆分为可嵌入的 `TextChunk` 序列。
 *
 * @description
 * 采用 **字符窗口 + 重叠 + 语义边界优先** 策略：在 `maxChars` 内优先于段落/句号处断开，
 * 避免硬切 mid-sentence；对尾部 overlap 做非递增保护，防止配置错误导致无限循环。
 *
 * **模块角色**：Knowledge Plugin · Ingest preprocessing。
 * **关键依赖**：无外部 I/O，仅依赖 {@link TextChunk} 类型契约。
 *
 * @module knowledge/indexer/chunker
 */

import type { TextChunk } from '../types.js';

/** 切分器运行时参数。 */
export type ChunkerConfig = {
  /** 单块最大字符数（硬上限）。 */
  maxChars: number;
  /** 相邻块重叠字符数，用于保留跨块上下文。 */
  overlapChars: number;
  /** 过小块合并阈值；末块可例外保留。 */
  minChars: number;
};

/** 默认切分参数（约 1k 字符块 + 200 重叠）。 */
const DEFAULT_CONFIG: ChunkerConfig = {
  maxChars: 1000,
  overlapChars: 200,
  minChars: 100,
};

/**
 * @description 将整篇文档文本切分为带偏移信息的块列表。
 *
 * @param text - 原始 UTF-8 文档正文。
 * @param sourceId - 写入 metadata 的来源标识。
 * @param config - 可选参数覆盖 {@link DEFAULT_CONFIG}。
 * @returns 按文档顺序排列的 {@link TextChunk} 数组；空文本返回 `[]`。
 */
export function chunkText(
  text: string,
  sourceId: string,
  config?: Partial<ChunkerConfig>,
): TextChunk[] {
  const { maxChars, overlapChars, minChars } = { ...DEFAULT_CONFIG, ...config };
  const chunks: TextChunk[] = [];
  let startOffset = 0;

  if (text.length === 0) return chunks;

  // 短文整篇作为单块，避免无意义切分
  if (text.length <= maxChars) {
    chunks.push({
      text: text.trim(),
      index: 0,
      sourceId,
      startOffset: 0,
      endOffset: text.length,
    });
    return chunks;
  }

  let index = 0;

  while (startOffset < text.length) {
    const endOffset = findSplitPoint(text, startOffset, maxChars);
    const chunkText = text.slice(startOffset, endOffset).trim();

    if (chunkText.length >= minChars || index === 0) {
      chunks.push({ text: chunkText, index, sourceId, startOffset, endOffset });
      index++;
    }

    /*
     * 已消费到文末必须立即退出；否则 overlap 回退会导致 endOffset 不变，
     * 长文档尾部陷入无限循环。
     */
    if (endOffset >= text.length) {
      break;
    }

    // overlap 过大时保证起点至少前进 1 字符
    startOffset = Math.max(endOffset - overlapChars, startOffset + 1);
  }

  return chunks;
}

/**
 * @description 在 `[start, start+maxChars)` 窗口内寻找最佳断点。
 *
 * 优先级：段落 `\n\n` → 中文句号 `。` → 硬截断。
 * 使用 `lastIndexOf` 自后向前扫描，避免大文本 `matchAll` OOM。
 *
 * @param text - 全文。
 * @param start - 当前块起始偏移。
 * @param maxChars - 窗口宽度上限。
 * @returns 不含 start 的结束偏移（开区间右端点）。
 */
function findSplitPoint(text: string, start: number, maxChars: number): number {
  const end = Math.min(start + maxChars, text.length);
  if (end === text.length) return end;

  const minSplit = Math.ceil(maxChars * 0.3);
  const segment = text.slice(start, end);

  const paraIdx = segment.lastIndexOf('\n\n', end - start - minSplit);
  if (paraIdx !== -1) return start + paraIdx + 2;

  const sentIdx = segment.lastIndexOf('。', end - start - minSplit);
  if (sentIdx !== -1) return start + sentIdx + 1;

  return end;
}
