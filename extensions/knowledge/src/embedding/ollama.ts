/**
 * @fileoverview Ollama 本地 Embedding — 通过官方 SDK 调用 `/api/embed`。
 *
 * **模块角色**：Knowledge Plugin · Embedding provider (Ollama local)。
 * **关键依赖**：`ollama` npm 包、`OLLAMA_HOST` 环境变量。
 *
 * @module knowledge/embedding/ollama
 */
import { Ollama } from 'ollama';
import type { EmbeddingService, KnowledgeEmbeddingConfig } from '../types.js';
import { DEFAULT_EMBEDDING_TIMEOUT_MS, inEmbeddingBatches, withEmbeddingTimeout } from './http.js';
import { assertVector } from '../store/vector-validation.js';

export class OllamaEmbeddingService implements EmbeddingService {
  readonly dimensions: number;
  readonly modelName: string;
  private client: Ollama;
  private config?: KnowledgeEmbeddingConfig;

  constructor(config?: KnowledgeEmbeddingConfig) {
    this.config = config;
    this.modelName = config?.model ?? 'embeddinggemma';
    this.dimensions = config?.dimensions ?? 768;
    this.client = new Ollama({ host: config?.baseUrl ?? process.env.OLLAMA_HOST });
  }

  async embed(text: string): Promise<number[]> {
    const response = await withEmbeddingTimeout(this.client.embed({
      model: this.modelName,
      input: text,
    }), this.config?.requestTimeoutMs ?? DEFAULT_EMBEDDING_TIMEOUT_MS, 'Ollama');
    // SDK 返回 { embeddings: number[][] }，单文本取第一项
    const vector = response.embeddings[0];
    assertVector(vector, this.dimensions, 'Ollama response vector');
    return vector;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return inEmbeddingBatches(texts, this.config, async (batch) => {
      const response = await withEmbeddingTimeout(this.client.embed({
        model: this.modelName,
        input: batch,
      }), this.config?.requestTimeoutMs ?? DEFAULT_EMBEDDING_TIMEOUT_MS, 'Ollama');
      if (response.embeddings.length !== batch.length) {
        throw new Error(`Ollama Embedding API returned ${response.embeddings.length} vectors; expected ${batch.length}`);
      }
      for (const vector of response.embeddings) assertVector(vector, this.dimensions, 'Ollama response vector');
      return response.embeddings;
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
