/**
 * @fileoverview 阿里云 DashScope（百炼）Embedding — OpenAI 兼容模式。
 *
 * @description 端点 `https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings`。
 * **模块角色**：Knowledge Plugin · Embedding provider (DashScope)。
 *
 * @module knowledge/embedding/dashscope
 */
import type { EmbeddingService, KnowledgeEmbeddingConfig } from '../types.js';

/** 默认模型 — text-embedding-v4 (Qwen3-Embedding 系列) */
const DEFAULT_MODEL = 'text-embedding-v4';
/** 默认维度 — v4 支持 2048/1536/1024(默认)/768/512/256/128/64 */
const DEFAULT_DIMENSIONS = 1024;
/** DashScope OpenAI 兼容端点 */
const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

/**
 * DashScope Embedding Service
 *
 * 采用阿里云百炼推荐的 OpenAI 兼容接口调用 Embedding 模型。
 * 支持 text-embedding-v4 / v3 / v2 / v1。
 */
export class DashScopeEmbeddingService implements EmbeddingService {
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

    // 遵循 OpenAI 兼容格式，文档示例：
    //   client.embeddings.create({ model, input, dimensions, encoding_format })
    const body: Record<string, unknown> = {
      model: this.modelName,
      input: texts,
      encoding_format: 'float',
    };

    // text-embedding-v3/v4 支持指定维度
    if (this.dimensions !== DEFAULT_DIMENSIONS) {
      body.dimensions = this.dimensions;
    }

    const url = `${this.baseUrl.replace(/\/+$/, '')}/embeddings`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown');
      throw new Error(`DashScope Embedding API error: ${response.status} — ${errorText}`);
    }

    const data = (await response.json()) as {
      data: { embedding: number[]; index: number }[];
      model?: string;
      usage?: { prompt_tokens: number; total_tokens: number };
    };

    if (!data.data) {
      throw new Error('DashScope Embedding API returned unexpected response format: missing data');
    }

    // 按 index 排序确保顺序与输入一致
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
