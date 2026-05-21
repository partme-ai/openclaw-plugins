/**
 * Tokenizer 引擎工厂
 *
 * 根据 provider 字段路由到对应的 TokenizerService 实现。
 * 支持 2 个 provider：zhipu（远程），tiktoken（本地）。
 *
 * 默认使用 tiktoken（本地），零配置即可工作。
 */
import type { TokenizerService, KnowledgeTokenizerConfig } from '../types.js';
import { TikTokenTokenizerService } from './tiktoken.js';
import { ZhipuTokenizerService } from './zhipu.js';

/**
 * 创建 TokenizerService 实例
 *
 * 路由逻辑：
 * 1. 如果 config 中有 provider 字段 → 按 provider 名精确匹配
 * 2. 无 provider → 默认使用 tiktoken（本地方案）
 *
 * @param config 可选的 Tokenizer 配置
 * @returns TokenizerService 实例
 */
export function createTokenizerService(config?: KnowledgeTokenizerConfig): TokenizerService {
  const provider = config?.provider?.toLowerCase() ?? '';

  if (provider) {
    switch (provider) {
      case 'zhipu':
        return new ZhipuTokenizerService(config);
      case 'tiktoken':
        return new TikTokenTokenizerService(config);
      default:
        throw new Error(
          `Unknown tokenizer provider: ${provider}. Supported: zhipu, tiktoken`
        );
    }
  }

  // 无显式 provider 时默认使用 tiktoken（本地方案）
  return new TikTokenTokenizerService(config);
}
