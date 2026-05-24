/**
 * @fileoverview Embedding 引擎工厂 — 按 `provider` 路由至各云端/本地嵌入实现。
 *
 * @description
 * 支持：`openai`、`dashscope`、`zhipu`、`qianfan`、`ollama`。
 * 无显式 provider 时若存在 `apiKey` 则回退 OpenAI 兼容客户端（兼容旧配置）。
 *
 * **模块角色**：Knowledge Plugin · Embedding adapter registry。
 * **关键依赖**：各 `*EmbeddingService` 具体实现模块。
 *
 * @module knowledge/embedding/factory
 */
import type { EmbeddingService, KnowledgeEmbeddingConfig } from '../types.js';
import { OpenAIEmbeddingService } from './openai.js';
import { DashScopeEmbeddingService } from './dashscope.js';
import { ZhipuEmbeddingService } from './zhipu.js';
import { QianfanEmbeddingService } from './qianfan.js';
import { OllamaEmbeddingService } from './ollama.js';

/**
 * @description 创建 {@link EmbeddingService} 实例。
 *
 * 路由逻辑：
 * 1. 显式 `provider` → switch 精确匹配；
 * 2. 无 provider 但有 `apiKey` → {@link OpenAIEmbeddingService}；
 * 3. 否则抛出配置错误。
 *
 * @param config - 可选 Embedding 配置片段。
 * @returns 满足 {@link EmbeddingService} 契约的运行时实例。
 * @throws 未知 provider 或完全未配置 provider/apiKey。
 */
export function createEmbeddingService(config?: KnowledgeEmbeddingConfig): EmbeddingService {
  const provider = config?.provider?.toLowerCase() ?? '';

  // 有显式 provider 则精确匹配
  if (provider) {
    switch (provider) {
      case 'openai':
        return new OpenAIEmbeddingService(config);
      case 'dashscope':
        return new DashScopeEmbeddingService(config);
      case 'zhipu':
        return new ZhipuEmbeddingService(config);
      case 'qianfan':
        return new QianfanEmbeddingService(config);
      case 'ollama':
        return new OllamaEmbeddingService(config);
      default:
        throw new Error(`Unknown embedding provider: ${provider}`);
    }
  }

  // 无显式 provider 时通过 apiKey 嗅探（兼容旧配置）
  if (config?.apiKey && config.apiKey.trim() !== '') {
    return new OpenAIEmbeddingService(config);
  }

  // 无 provider 也无 apiKey → 抛出错误
  throw new Error(
    'No embedding provider configured. Set "embedding.provider" in your ' +
    'knowledge config to one of: openai, dashscope, zhipu, qianfan, ollama'
  );
}
