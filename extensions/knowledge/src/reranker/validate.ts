/** 外部 Reranker 响应的契约校验与确定性排序。 */
import type { ScoredDocument } from '../types.js';

/**
 * 校验索引、分数范围和唯一性，并始终从原始输入恢复文本。
 *
 * Provider 返回的 document 字段不可信且可能缺失；使用输入数组可避免返回内容与 index 不一致
 * 污染最终 RAG 上下文。
 */
export function validateRerankResults(
  results: unknown,
  documents: string[],
  topN: number | undefined,
  provider: string,
): ScoredDocument[] {
  if (!Array.isArray(results)) throw new Error(`${provider} Reranker returned an invalid results array`);
  const seen = new Set<number>();
  const normalized = results.map((item): ScoredDocument => {
    if (!item || typeof item !== 'object') throw new Error(`${provider} Reranker returned an invalid result`);
    const value = item as { index?: unknown; score?: unknown; relevance_score?: unknown };
    const index = value.index;
    const score = value.relevance_score ?? value.score;
    if (!Number.isSafeInteger(index) || (index as number) < 0 || (index as number) >= documents.length) {
      throw new Error(`${provider} Reranker returned an out-of-range document index`);
    }
    if (seen.has(index as number)) throw new Error(`${provider} Reranker returned a duplicate document index`);
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) {
      throw new Error(`${provider} Reranker returned a score outside 0-1`);
    }
    seen.add(index as number);
    return { text: documents[index as number] as string, index: index as number, score };
  });
  normalized.sort((left, right) => right.score - left.score || left.index - right.index);
  const limit = topN && topN > 0 ? Math.min(topN, normalized.length) : normalized.length;
  return normalized.slice(0, limit);
}
