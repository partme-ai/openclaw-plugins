/**
 * Reranker 引擎工厂
 *
 * 根据 provider 字段路由到对应的 RerankerService 实现。
 * 支持 3 个 provider：zhipu（远程），jina（远程），ollama（本地）。
 *
 * 未配置时默认使用 ollama 本地方案（零配置即可在本地部署 Qwen3-Reranker 模型）。
 */
import type { RerankerService, KnowledgeRerankerConfig } from '../types.js';
import { ZhipuRerankerService } from './zhipu.js';
import { JinaRerankerService } from './jina.js';
import { OllamaRerankerService } from './ollama.js';

/**
 * 创建 RerankerService 实例
 *
 * @param config 可选的 Reranker 配置
 * @returns RerankerService 实例
 * @throws Error 当配置了未知 provider 时
 */
export function createRerankerService(config?: KnowledgeRerankerConfig): RerankerService {
  const provider = config?.provider?.toLowerCase() ?? '';

  if (provider) {
    switch (provider) {
      case 'zhipu':
        return new ZhipuRerankerService(config);
      case 'jina':
        return new JinaRerankerService(config);
      case 'ollama':
        return new OllamaRerankerService(config);
      default:
        throw new Error(
          `Unknown reranker provider: ${provider}. Supported: zhipu, jina, ollama`
        );
    }
  }

  // 无显式 provider 时默认使用 ollama 本地方案
  return new OllamaRerankerService(config);
}
