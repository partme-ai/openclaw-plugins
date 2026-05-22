/**
 * Ollama Embedding Service
 *
 * 使用 Ollama 官方 SDK 调用本地嵌入模型，生成 L2 归一化的文本嵌入向量。
 * 调用 ollama.embed() — SDK 内部使用 POST /api/embed
 *
 * 默认模型：embeddinggemma（Ollama 官方推荐）
 * SDK 默认连接 http://localhost:11434（可通过 OLLAMA_HOST 环境变量覆盖）
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
