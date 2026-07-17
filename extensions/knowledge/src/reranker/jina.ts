/**
 * @fileoverview Jina AI Reranker 云端 API。
 *
 * **模块角色**：Knowledge Plugin · Reranker provider (Jina)。
 *
 * @module knowledge/reranker/jina
 */
import type { RerankerService, KnowledgeRerankerConfig, ScoredDocument } from '../types.js';
import { requestProviderJson } from '../shared/provider-http.js';
import { validateRerankResults } from './validate.js';

/** 默认模型 */
const DEFAULT_MODEL = 'jina-reranker-v2-base-multilingual';
/** Jina AI 云端 API 端点 */
const DEFAULT_BASE_URL = 'https://api.jina.ai/v1';

/**
 * Jina 云端二阶段精排适配器。
 *
 * 候选文档最多 128 条；远端只被信任为“索引和分数”的来源，返回文本会被忽略并
 * 从原始候选恢复，避免供应商响应篡改后续注入到模型的知识内容。
 */
export class JinaRerankerService implements RerankerService {
  readonly modelName: string;
  private baseUrl: string;
  private apiKey: string;
  private topN: number;
  private config?: KnowledgeRerankerConfig;

  constructor(config?: KnowledgeRerankerConfig) {
    this.config = config;
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
    if (documents.length > 128) throw new Error('Jina Reranker supports max 128 documents per request');

    const body: Record<string, unknown> = {
      model: this.modelName,
      query,
      documents,
      top_n: topN ?? this.topN,
    };

    const url = `${this.baseUrl.replace(/\/+$/, '')}/rerank`;
    const data = await requestProviderJson<{ results?: unknown }>(url, {
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
    }, 'Jina', 'Reranker');

    return validateRerankResults(data.results, documents, topN ?? this.topN, 'Jina');
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
