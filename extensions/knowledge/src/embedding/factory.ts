/**
 * Embedding 引擎工厂
 *
 * 根据 provider 字段路由到对应的 Embedding Service 实现。
 * 支持 8 个 provider：openai, dashscope, zhipu, moonshot, sensenova, qianfan, pangu, ollama
 *
 * 无显式 provider 时通过 apiKey 嗅探（兼容旧配置）。
 */
import type { EmbeddingService, KnowledgeEmbeddingConfig } from '../types.js';
import { OpenAIEmbeddingService } from './openai.js';
import { DashScopeEmbeddingService } from './dashscope.js';
import { ZhipuEmbeddingService } from './zhipu.js';
import { QianfanEmbeddingService } from './qianfan.js';
import { OllamaEmbeddingService } from './ollama.js';

/**
 * 创建 EmbeddingService 实例
 *
 * 路由逻辑：
 * 1. 如果 config 中有 provider 字段 → 按 provider 名精确匹配
 * 2. 无 provider 但有 apiKey → 使用 OpenAIEmbeddingService（向后兼容）
 * 3. 无 provider 也无 apiKey → 抛出错误
 *
 * @param config 可选的 Embedding 配置
 * @returns EmbeddingService 实例
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
