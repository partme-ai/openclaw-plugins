/**
 * @fileoverview 智谱 Rerank API — 远程二阶段精排。
 *
 * **模块角色**：Knowledge Plugin · Reranker provider (Zhipu)。
 *
 * @module knowledge/reranker/zhipu
 */
import type { RerankerService, KnowledgeRerankerConfig, ScoredDocument } from '../types.js';
import { requestProviderJson } from '../shared/provider-http.js';
import { validateRerankResults } from './validate.js';

/** 默认模型 */
const DEFAULT_MODEL = 'rerank';
/** 智谱 Rerank API 端点 */
const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4/rerank';

/**
 * 智谱云端 Rerank API 适配器。
 *
 * 请求最多携带 128 条候选，响应经统一大小限制和结构校验；排序文本始终取自本地
 * 原始候选，外部服务只能影响次序和分数，不能替换最终注入内容。
 */
export class ZhipuRerankerService implements RerankerService {
  readonly modelName: string;
  private baseUrl: string;
  private apiKey: string;
  private topN: number;
  private returnDocuments: boolean;
  private config?: KnowledgeRerankerConfig;

  constructor(config?: KnowledgeRerankerConfig) {
    this.config = config;
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

    const data = await requestProviderJson<{ results?: unknown }>(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    }, {
      timeoutMs: this.config?.requestTimeoutMs,
      maxRetries: this.config?.maxRetries,
      maxResponseBytes: this.config?.maxResponseBytes,
    }, 'Zhipu', 'Reranker');

    return validateRerankResults(data.results, documents, topN ?? this.topN, 'Zhipu');
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
