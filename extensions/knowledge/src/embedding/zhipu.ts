/**
 * @fileoverview 智谱 AI Embedding API 适配器（OpenAI 兼容 `/embeddings`）。
 *
 * **模块角色**：Knowledge Plugin · Embedding provider (Zhipu)。
 *
 * @module knowledge/embedding/zhipu
 */
import type { EmbeddingService, KnowledgeEmbeddingConfig } from '../types.js';
import { inEmbeddingBatches, postEmbeddingJson, validateEmbeddingData } from './http.js';

/** 默认模型 */
const DEFAULT_MODEL = 'embedding-3';
/** 默认维度 (embedding-3) */
const DEFAULT_DIMENSIONS = 2048;
/** 智谱 AI API 端点 */
const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4/embeddings';

/**
 * 智谱 Embedding API 适配器。
 *
 * `embedding-3` 可按配置传递维度，其他模型保持服务端固定维度；所有响应都会在
 * 返回前核对条目数和向量维度，外部 API 的异常数据不会进入持久化 Store。
 */
export class ZhipuEmbeddingService implements EmbeddingService {
  readonly dimensions: number;
  readonly modelName: string;
  private baseUrl: string;
  private apiKey: string;
  private config?: KnowledgeEmbeddingConfig;

  constructor(config?: KnowledgeEmbeddingConfig) {
    this.config = config;
    this.baseUrl = config?.baseUrl ?? DEFAULT_BASE_URL;
    this.apiKey = config?.apiKey ?? '';
    this.modelName = config?.model ?? DEFAULT_MODEL;
    this.dimensions = config?.dimensions ?? DEFAULT_DIMENSIONS;
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return inEmbeddingBatches(texts, this.config, async (batch) => {

    const body: Record<string, unknown> = {
      model: this.modelName,
      input: batch,
    };

    // embedding-3 支持自定义维度，embedding-2 固定 1024 不支持
    // 仅在模型支持且维度非默认值时才传 dimensions
    if (this.modelName === 'embedding-3' && this.dimensions !== DEFAULT_DIMENSIONS) {
      body.dimensions = this.dimensions;
    }

    const data = await postEmbeddingJson<{ data?: unknown }>(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    }, this.config, 'Zhipu');
    return validateEmbeddingData(data.data, batch.length, this.dimensions, 'Zhipu');
    });
  }

  async health(): Promise<boolean> {
    try {
      const result = await this.embed('health check');
      return Array.isArray(result) && result.length === this.dimensions;
    } catch {
      return false;
    }
  }
}
