/**
 * @fileoverview 混合检索器 — 向量语义 + 关键词（FTS/BM25 近似）融合召回。
 *
 * @description
 * 支持三种策略：
 * - `vector` — 纯余弦/内积向量检索；
 * - `keyword` — 优先 `store.keywordSearch`（FTS5），否则降级词频匹配；
 * - `hybrid` — 向量与关键词分数按权重融合（默认 0.7:0.3）。
 *
 * **模块角色**：Knowledge Plugin · Retrieval layer（`before_prompt_build` 与 `knowledge_query` 共用）。
 * **关键依赖**：`EmbeddingService`、`VectorStore`、可选 FTS5 后端。
 *
 * @module knowledge/retriever/hybrid
 */

import type { EmbeddingService, VectorStore, SearchOptions, ScoredChunk } from '../types.js';

/** 混合检索可调参数。 */
export type HybridRetrievalConfig = {
  /** 检索策略枚举。 */
  strategy: 'hybrid' | 'vector' | 'keyword';
  /** hybrid 模式下向量分支权重（0-1）。 */
  vectorWeight: number;
  /** hybrid 模式下关键词分支权重（0-1）。 */
  keywordWeight: number;
  /** BM25 参数 k1（预留，简易降级路径未使用）。 */
  k1: number;
  /** BM25 参数 b（预留）。 */
  b: number;
};

const DEFAULT_CONFIG: HybridRetrievalConfig = {
  strategy: 'hybrid',
  vectorWeight: 0.7,
  keywordWeight: 0.3,
  k1: 1.5,
  b: 0.75,
};

/**
 * @description 按策略执行检索并返回按分数降序的 {@link ScoredChunk} 列表。
 *
 * @param query - 用户查询文本。
 * @param embedding - 用于 vector/hybrid 分支的嵌入服务。
 * @param store - 向量存储后端。
 * @param options - 含 `topK`、`minScore`、`sourceId` 及可选 `config` 策略覆盖。
 * @returns Top-K 打分块；hybrid 模式下按融合分数排序。
 * @throws 未知 `strategy` 枚举值。
 */
export async function hybridSearch(
  query: string,
  embedding: EmbeddingService,
  store: VectorStore,
  options?: SearchOptions & { config?: Partial<HybridRetrievalConfig> },
): Promise<ScoredChunk[]> {
  const config = { ...DEFAULT_CONFIG, ...options?.config };
  const topK = options?.topK ?? 5;

  switch (config.strategy) {
    case 'vector': {
      const vector = await embedding.embed(query);
      return store.search(vector, options);
    }

    case 'keyword': {
      return keywordSearch(query, store, topK, options?.sourceId);
    }

    case 'hybrid': {
      // 双路并行召回，各自扩大 topK 供融合阶段裁剪
      const vector = await embedding.embed(query);
      const [vectorResults, keywordResults] = await Promise.all([
        store.search(vector, { ...options, topK: topK * 2 }),
        keywordSearch(query, store, topK * 2, options?.sourceId),
      ]);

      return fuseResults(
        vectorResults,
        keywordResults,
        config.vectorWeight,
        config.keywordWeight,
        topK,
      );
    }

    default:
      throw new Error(`Unknown retrieval strategy: ${config.strategy}`);
  }
}

/**
 * @description 关键词分支入口：优先 FTS5，否则全量扫描 + 词频近似。
 *
 * @param query - 查询串。
 * @param store - 向量库（可选实现 `keywordSearch`）。
 * @param topK - 返回上限。
 * @param sourceId - 可选来源过滤。
 */
async function keywordSearch(
  query: string,
  store: VectorStore,
  topK: number,
  sourceId?: string,
): Promise<ScoredChunk[]> {
  if (store.keywordSearch) {
    return store.keywordSearch(query, topK, sourceId);
  }

  return simpleKeywordSearch(query, store, topK, sourceId);
}

/**
 * @description 无 FTS 后端的降级路径：对 store 全量块做 query 词命中比例打分。
 *
 * @remarks 通过零向量大 topK 搜索近似拉取全表，仅适用于小型数据集。
 */
async function simpleKeywordSearch(
  query: string,
  store: VectorStore,
  topK: number,
  sourceId?: string,
): Promise<ScoredChunk[]> {
  const allChunks = await getAllChunks(store, sourceId);
  if (allChunks.length === 0) return [];

  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  const scored: ScoredChunk[] = allChunks.map((chunk) => {
    const docTerms = tokenize(chunk.metadata.text);
    const docLen = docTerms.length;
    if (docLen === 0) return { chunk, score: 0 };

    let matched = 0;
    for (const term of queryTerms) {
      if (docTerms.includes(term)) matched++;
    }

    const score = matched / queryTerms.length;
    return { chunk, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * @description 按 chunk.id 合并双路分数：`vectorScore * wV + keywordScore * wK`。
 *
 * @param vectorResults - 向量检索原始结果。
 * @param keywordResults - 关键词检索原始结果。
 * @param vectorWeight - 向量权重。
 * @param keywordWeight - 关键词权重。
 * @param topK - 最终返回条数。
 */
function fuseResults(
  vectorResults: ScoredChunk[],
  keywordResults: ScoredChunk[],
  vectorWeight: number,
  keywordWeight: number,
  topK: number,
): ScoredChunk[] {
  const scores = new Map<string, { chunk: ScoredChunk['chunk']; score: number }>();

  for (const item of vectorResults) {
    scores.set(item.chunk.id, {
      chunk: item.chunk,
      score: item.score * vectorWeight,
    });
  }

  for (const item of keywordResults) {
    const existing = scores.get(item.chunk.id);
    if (existing) {
      existing.score += item.score * keywordWeight;
    } else {
      scores.set(item.chunk.id, {
        chunk: item.chunk,
        score: item.score * keywordWeight,
      });
    }
  }

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ chunk, score }) => ({ chunk, score }));
}

/**
 * @description 近似全量读取 store 内块（零向量 + 超大 topK）。
 *
 * @remarks 生产环境应替换为专用分页 API；当前为第一版 pragmatic 方案。
 */
async function getAllChunks(store: VectorStore, sourceId?: string): Promise<ScoredChunk['chunk'][]> {
  const dummyVector = new Array(384).fill(0);
  const results = await store.search(dummyVector, {
    topK: 10000,
    minScore: 0,
    sourceId,
  });
  return results.map((r) => r.chunk);
}

/**
 * @description 简易中英分词：英文按词、中文单字 + 相邻二元组。
 *
 * @param text - 待分词原文。
 * @returns 去重后的 token 列表（小写英文）。
 */
function tokenize(text: string): string[] {
  const words: string[] = [];

  const englishWords = text.match(/[a-zA-Z0-9]+/g) || [];
  words.push(...englishWords.map((w) => w.toLowerCase()));

  const chineseChars = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || [];
  for (let i = 0; i < chineseChars.length; i++) {
    words.push(chineseChars[i]);
    if (i + 1 < chineseChars.length) {
      words.push(chineseChars[i] + chineseChars[i + 1]);
    }
  }

  return [...new Set(words)];
}
