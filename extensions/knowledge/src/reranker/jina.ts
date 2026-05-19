/**
 * JinaRerankerService — Jina AI Reranker 云端 API 实现
 *
 * 通过 Jina AI 的云端 rerank 端点对候选文档进行重排序。
 * 支持中英文混合场景，需要 Jina AI API Key。
 *
 * API: POST https://api.jina.ai/v1/rerank
 * body: { model, query, documents, top_n }
 * response: { results: [{ index, relevance_score }] }
 * 文档: https://jina.ai/reranker
 */
import type { RerankerService, KnowledgeRerankerConfig, ScoredDocument } from '../types.js';

/** 默认模型 */
const DEFAULT_MODEL = 'jina-reranker-v2-base-multilingual';
/** Jina AI 云端 API 端点 */
const DEFAULT_BASE_URL = 'https://api.jina.ai/v1';

export class JinaRerankerService implements RerankerService {
  readonly modelName: string;
  private baseUrl: string;
  private apiKey: string;
  private topN: number;

  constructor(config?: KnowledgeRerankerConfig) {
    this.baseUrl = config?.baseUrl ?? DEFAULT_BASE_URL;
    this.apiKey = config?.apiKey ?? '';
    this.modelName = config?.model ?? DEFAULT_MODEL;
    this.topN = config?.topN ?? 0;
  }

  async rerank(query: string, documents: string[], topN?: number): Promise<ScoredDocument[]> {
    if (documents.length === 0) return [];
    if (!this.apiKey) {
      throw new Error('Jina Reranker requires apiKey for cloud API');
    }

    const body: Record<string, unknown> = {
      model: this.modelName,
      query,
      documents,
      top_n: topN ?? this.topN,
    };

    const url = `${this.baseUrl.replace(/\/+$/, '')}/rerank`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown');
      throw new Error(`Jina Rerank API error: ${response.status} — ${errorText}`);
    }

    const data = (await response.json()) as {
      results: { index: number; relevance_score: number }[];
      usage?: { total_tokens: number };
    };

    return data.results.map((r) => ({
      text: '', // Jina API 默认不返回原始文本
      index: r.index,
      score: r.relevance_score,
    }));
  }

  async health(): Promise<boolean> {
    try {
      const result = await this.rerank('health', ['check']);
      return Array.isArray(result);
    } catch {
      return false;
    }
  }
}
