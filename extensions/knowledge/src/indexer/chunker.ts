/**
 * 文档索引器 — 文本切分策略
 *
 * 支持基于文本长度和段落结构的智能切分。
 */

import type { TextChunk } from '../types.js';

/** 切分配置 */
export type ChunkerConfig = {
  /** 每块最大字符数 */
  maxChars: number;
  /** 块间重叠字符数 */
  overlapChars: number;
  /** 最小块字符数（小于此的块被合并到前一块） */
  minChars: number;
};

/** 默认切分配置 */
const DEFAULT_CONFIG: ChunkerConfig = {
  maxChars: 1000,
  overlapChars: 200,
  minChars: 100,
};

/**
 * 将纯文本切分为块
 */
export function chunkText(
  text: string,
  sourceId: string,
  config?: Partial<ChunkerConfig>,
): TextChunk[] {
  const { maxChars, overlapChars, minChars } = { ...DEFAULT_CONFIG, ...config };
  const chunks: TextChunk[] = [];
  let startOffset = 0;

  // 空文本
  if (text.length === 0) return chunks;

  // 如果文本很短，直接作为一块
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

    // 计算下一次起始位置（含重叠）
    startOffset = endOffset - overlapChars;
    if (startOffset < 0) startOffset = 0;
  }

  return chunks;
}

/**
 * 在[maxChars]范围内找到合适的分割点
 * 优先：段落边界 → 句子边界 → 字符边界（兜底）
 *
 * 使用 lastIndexOf 替代 matchAll 展开迭代器，避免大文本场景的 OOM。
 */
function findSplitPoint(text: string, start: number, maxChars: number): number {
  const end = Math.min(start + maxChars, text.length);
  if (end === text.length) return end;

  const minSplit = Math.ceil(maxChars * 0.3);
  const segment = text.slice(start, end);

  // 从后向前找段落分隔符
  const paraIdx = segment.lastIndexOf('\n\n', end - start - minSplit);
  if (paraIdx !== -1) return start + paraIdx + 2;

  // 从后向前找句号
  const sentIdx = segment.lastIndexOf('。', end - start - minSplit);
  if (sentIdx !== -1) return start + sentIdx + 1;

  // 兜底：直接截断
  return end;
}
