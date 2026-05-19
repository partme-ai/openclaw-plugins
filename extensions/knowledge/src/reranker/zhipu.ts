/**
 * ZhipuRerankerService — 智谱 AI Rerank API 实现（远程方案）
 *
 * 调用智谱 AI 的 rerank API 对候选文档进行精细重排序。
 * 支持 query + documents（最多128条），返回相关性得分。
 *
 * API: POST https://open.bigmodel.cn/api/paas/v4/rerank
 * 文档: https://docs.bigmodel.cn/api-reference/模型-api/文本重排序
 */
import type { RerankerService, KnowledgeRerankerConfig, ScoredDocument } from '../types.js';

/** 默认模型 */
const DEFAULT_MODEL = 'rerank';
/** 智谱 Rerank API 端点 */
const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4/rerank';

export class ZhipuRerankerService implements RerankerService {
  readonly modelName: string;
  private baseUrl: string;
  private apiKey: string;
  private topN: number;
  private returnDocuments: boolean;

  constructor(config?: KnowledgeRerankerConfig) {
    this.baseUrl = config?.baseUrl ?? DEFAULT_BASE_URL;
    this.apiKey = config?.apiKey ?? '';
    this.modelName = config?.model ?? DEFAULT_MODEL;
    this.topN = config?.topN ?? 0;
    this.returnDocuments = config?.returnDocuments ?? true;
  }

  async rerank(query: string, documents: string[], topN?: number): Promise<ScoredDocument[]> {
    if (!this.apiKey) {
      throw new Error('Zhipu Reranker requires apiKey');
    }
    if (documents.length === 0) return [];
    if (documents.length > 128) {
      throw new Error('Zhipu Reranker supports max 128 documents per request');
    }

    const body: Record<string, unknown> = {
      model: this.modelName,
      query,
      documents,
      top_n: topN ?? this.topN,
      return_documents: this.returnDocuments,
    };

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown');
      throw new Error(`Zhipu Rerank API error: ${response.status} — ${errorText}`);
    }

    const data = (await response.json()) as {
      results: { document: string; index: number; relevance_score: number }[];
      usage?: { prompt_tokens: number; total_tokens: number };
    };

    return data.results.map((r) => ({
      text: r.document,
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
