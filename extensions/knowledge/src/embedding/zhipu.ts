/**
 * 智谱 AI Embedding API 实现
 *
 * 智谱 Embedding API 兼容 OpenAI 格式：
 *   POST https://open.bigmodel.cn/api/paas/v4/embeddings
 *   鉴权: Bearer <token>
 *   请求体: { model, input, dimensions }
 *
 * - embedding-3 支持自定义维度 (2048/1024/512/256)，默认 2048
 * - embedding-2 固定 1024 维，不支持 dimensions 参数
 * - 支持批量：embedding-3 最大 64 条/请求
 *
 * 官方文档: https://docs.bigmodel.cn/api-reference/模型-api/文本嵌入
 */
import type { EmbeddingService, KnowledgeEmbeddingConfig } from '../types.js';

/** 默认模型 */
const DEFAULT_MODEL = 'embedding-3';
/** 默认维度 (embedding-3) */
const DEFAULT_DIMENSIONS = 2048;
/** 智谱 AI API 端点 */
const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4/embeddings';

export class ZhipuEmbeddingService implements EmbeddingService {
  readonly dimensions: number;
  readonly modelName: string;
  private baseUrl: string;
  private apiKey: string;

  constructor(config?: KnowledgeEmbeddingConfig) {
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

    const body: Record<string, unknown> = {
      model: this.modelName,
      input: texts,
    };

    // embedding-3 支持自定义维度，embedding-2 固定 1024 不支持
    // 仅在模型支持且维度非默认值时才传 dimensions
    if (this.modelName === 'embedding-3' && this.dimensions !== DEFAULT_DIMENSIONS) {
      body.dimensions = this.dimensions;
    }

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown');
      throw new Error(`Zhipu Embedding API error: ${response.status} — ${errorText}`);
    }

    const data = (await response.json()) as {
      data: { index: number; embedding: number[] }[];
      model?: string;
      usage?: { prompt_tokens: number; total_tokens: number };
    };

    if (!data.data) {
      throw new Error('Zhipu Embedding API returned unexpected response format: missing data');
    }

    // 智谱 API 返回 OpenAI 兼容格式
    const sorted = data.data.sort((a, b) => a.index - b.index);
    return sorted.map((item) => item.embedding);
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
