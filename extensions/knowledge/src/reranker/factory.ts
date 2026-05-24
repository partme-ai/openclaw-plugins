/**
 * @fileoverview Reranker 引擎工厂 — 二阶段精排可选节点。
 *
 * @description 支持 `zhipu`、`jina`、`ollama`；无 provider 时默认本地 Ollama。
 * **模块角色**：Knowledge Plugin · Reranker adapter registry。
 *
 * @module knowledge/reranker/factory
 */
import type { RerankerService, KnowledgeRerankerConfig } from '../types.js';
import { ZhipuRerankerService } from './zhipu.js';
import { JinaRerankerService } from './jina.js';
import { OllamaRerankerService } from './ollama.js';

/**
 * @description 创建 {@link RerankerService}；未知 provider 时抛出。
 *
 * @param config - 可选 Reranker 配置。
 * @returns 精排服务实例。
 * @throws 配置了不支持的 provider。
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
