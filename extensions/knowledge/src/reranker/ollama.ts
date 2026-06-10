/**
 * @fileoverview Ollama 本地 Reranker — 通过 Chat API 模拟 Qwen3-Reranker 打分。
 *
 * @description 将 query + documents 拼入 prompt，解析模型输出的相关性分数并排序。
 * **模块角色**：Knowledge Plugin · Reranker provider (Ollama local)。
 *
 * @module knowledge/reranker/ollama
 */
import { Ollama } from 'ollama';
import type { RerankerService, KnowledgeRerankerConfig, ScoredDocument } from '../types.js';

/** 默认模型 — Qwen3-Reranker-4B 量化版（2.5GB，性价比最优） */
const DEFAULT_MODEL = 'dengcao/Qwen3-Reranker-4B:Q4_K_M';
/** 默认 Ollama 端点 */
const DEFAULT_HOST = 'http://localhost:11434';

/**
 * 构建 rerank prompt
 *
 * cross-encoder rerank 的标准做法：让模型判断每个文档与 query 的相关性，
 * 返回一个 0-1 的分数。这里让模型一次性处理所有文档以提高吞吐。
 */
function buildRerankPrompt(query: string, documents: string[]): string {
  const docList = documents
    .map((doc, i) => `[${i}] ${doc}`)
    .join('\n\n');

  return `请判断以下文档与查询的相关性，输出每个文档的相关性分数（0-1，1为最相关）。
仅输出 JSON 格式，不要其他内容。

查询：${query}

文档：
${docList}

请按以下 JSON 格式输出：
{"results": [{"index": 0, "score": 0.95}, {"index": 1, "score": 0.85}, ...]}`;
}

export class OllamaRerankerService implements RerankerService {
  readonly modelName: string;
  private client: Ollama;
  private topN: number;

  constructor(config?: KnowledgeRerankerConfig) {
    this.client = new Ollama({ host: config?.baseUrl ?? DEFAULT_HOST });
    this.modelName = config?.model ?? DEFAULT_MODEL;
    this.topN = config?.topN ?? 0;
  }

  async rerank(query: string, documents: string[], topN?: number): Promise<ScoredDocument[]> {
    if (documents.length === 0) return [];

    const prompt = buildRerankPrompt(query, documents);

    const response = await this.client.chat({
      model: this.modelName,
      messages: [{ role: 'user', content: prompt }],
      options: {
        temperature: 0,   // 确定性输出
        num_predict: 4096, // 足够输出 JSON 结果
      },
    });

    const content = response.message?.content ?? '';
    const results = this.parseResults(content);

    if (results.length === 0) {
      throw new Error('Ollama Reranker returned no parseable results');
    }

    // 按 score 降序排列
    const sorted = results.sort((a, b) => b.score - a.score);

    const limit = (topN ?? this.topN) || sorted.length;
    return sorted.slice(0, limit).map((r) => ({
      text: documents[r.index] ?? '',
      index: r.index,
      score: r.score,
    }));
  }

  async health(): Promise<boolean> {
    try {
      const result = await this.rerank('health', ['check']);
      return Array.isArray(result) && result.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * 从模型输出中解析 JSON 结果
   * 支持多种输出格式：纯 JSON、带 markdown 代码块、带前缀文本
   */
  private parseResults(content: string): { index: number; score: number }[] {
    // 尝试提取 JSON 代码块
    const jsonBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonBlockMatch?.[1] ?? content;

    try {
      const parsed = JSON.parse(jsonStr.trim());
      if (parsed.results && Array.isArray(parsed.results)) {
        return parsed.results as { index: number; score: number }[];
      }
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // JSON 解析失败，尝试用正则提取每行的分数
      const results: { index: number; score: number }[] = [];
      const lines = content.split('\n');
      for (const line of lines) {
        const match = line.match(/\[(\d+)\]\s*[:：]\s*([0-9.]+)/);
        if (match) {
          results.push({ index: parseInt(match[1]), score: parseFloat(match[2]) });
        }
      }
      if (results.length > 0) return results;
    }

    return [];
  }
}
