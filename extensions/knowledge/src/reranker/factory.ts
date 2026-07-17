/**
 * @fileoverview Reranker 引擎工厂 — 二阶段精排可选节点。
 *
 * @description 支持具有正式 Rerank HTTP 契约的 `zhipu`、`jina`。
 * **模块角色**：Knowledge Plugin · Reranker adapter registry。
 *
 * @module knowledge/reranker/factory
 */
import type { RerankerService, KnowledgeRerankerConfig } from '../types.js';
import { ZhipuRerankerService } from './zhipu.js';
import { JinaRerankerService } from './jina.js';

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
      default:
        throw new Error(
          `Unknown reranker provider: ${provider}. Supported: zhipu, jina`
        );
    }
  }

  // Reranker 是可选节点，工厂不能静默猜测外部服务。调用方应在未配置时跳过创建。
  throw new Error('Reranker provider is required. Supported: zhipu, jina');
}
