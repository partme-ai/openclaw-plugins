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

export class OllamaEmbeddingService implements EmbeddingService {
  readonly dimensions: number;
  readonly modelName: string;
  private client: Ollama;

  constructor(config?: KnowledgeEmbeddingConfig) {
    this.modelName = config?.model ?? 'embeddinggemma';
    this.dimensions = config?.dimensions ?? 768;
    this.client = new Ollama({ host: config?.baseUrl ?? process.env.OLLAMA_HOST });
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embed({
      model: this.modelName,
      input: text,
    });
    // SDK 返回 { embeddings: number[][] }，单文本取第一项
    return response.embeddings[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const response = await this.client.embed({
      model: this.modelName,
      input: texts,
    });
    return response.embeddings;
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
