/**
 * @fileoverview 百度千帆 Embedding — OpenAI 兼容 `/v2/embeddings`。
 *
 * **模块角色**：Knowledge Plugin · Embedding provider (Qianfan)。
 *
 * @module knowledge/embedding/qianfan
 */
import type { EmbeddingService, KnowledgeEmbeddingConfig } from '../types.js';
import { inEmbeddingBatches, postEmbeddingJson, validateEmbeddingData } from './http.js';

/** 默认模型 */
const DEFAULT_MODEL = 'embedding-v1';
/** 默认维度 */
const DEFAULT_DIMENSIONS = 384;
/** 千帆 OpenAI 兼容端点 */
const DEFAULT_BASE_URL = 'https://qianfan.baidubce.com/v2';

/**
 * 百度千帆 OpenAI 兼容 Embedding 客户端。
 *
 * 使用 Bearer 凭据访问 `/v2/embeddings`，并复用统一的超时、有限重试、响应大小
 * 和向量完整性校验。调用方只接收与输入顺序一致的可信向量数组。
 */
export class QianfanEmbeddingService implements EmbeddingService {
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

    if (!this.apiKey) {
      throw new Error('Qianfan Embedding requires apiKey (BCE IAM token)');
    }

    return inEmbeddingBatches(texts, this.config, async (batch) => {
    // 遵循千帆 OpenAI 兼容格式:
    //   curl 'https://qianfan.baidubce.com/v2/embeddings' \
    //     -H 'Authorization: Bearer <token>' \
    //     -d '{ "model": "embedding-v1", "input": ["text"] }'
    const body: Record<string, unknown> = {
      model: this.modelName,
      input: batch,
    };

    const url = `${this.baseUrl.replace(/\/+$/, '')}/embeddings`;
    const data = await postEmbeddingJson<{ data?: unknown }>(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    }, this.config, 'Qianfan');
    return validateEmbeddingData(data.data, batch.length, this.dimensions, 'Qianfan');
    }, this.modelName === 'tao-8k' ? 1 : 16);
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
