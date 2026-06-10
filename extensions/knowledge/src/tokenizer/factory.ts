/**
 * @fileoverview Tokenizer 引擎工厂 — Prompt 上下文截断可选节点。
 *
 * @description 支持 `zhipu`（远程精确）、`tiktoken`（本地默认）。
 * **模块角色**：Knowledge Plugin · Tokenizer adapter registry。
 *
 * @module knowledge/tokenizer/factory
 */
import type { TokenizerService, KnowledgeTokenizerConfig } from '../types.js';
import { TikTokenTokenizerService } from './tiktoken.js';
import { ZhipuTokenizerService } from './zhipu.js';

/**
 * @description 创建 {@link TokenizerService}；无 provider 时默认 tiktoken。
 *
 * @param config - 可选 Tokenizer 配置。
 * @returns Token 计数/截断服务实例。
 * @throws 未知 provider。
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
