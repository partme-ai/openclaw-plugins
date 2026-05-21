/**
 * DocParser 引擎工厂
 *
 * 根据 provider 字段路由到对应的 DocParserService 实现。
 * 支持 2 个 provider：zhipu（远程），ollama（本地）。
 *
 * 未配置时默认使用 ollama 本地方案（零配置即可运行 glm-ocr）。
 */
import type { DocParserService, KnowledgeParserConfig } from '../types.js';
import { ZhipuDocParserService } from './zhipu.js';
import { OllamaDocParserService } from './ollama.js';

/**
 * 创建 DocParserService 实例
 *
 * @param config 可选的 DocParser 配置
 * @returns DocParserService 实例
 * @throws Error 当配置了未知 provider 时
 */
export function createParserService(config?: KnowledgeParserConfig): DocParserService {
  const provider = config?.provider?.toLowerCase() ?? '';

  if (provider) {
    switch (provider) {
      case 'zhipu':
        return new ZhipuDocParserService(config);
      case 'ollama':
        return new OllamaDocParserService(config);
      default:
        throw new Error(
          `Unknown parser provider: ${provider}. Supported: zhipu, ollama`
        );
    }
  }

  // 无显式 provider 时默认使用 ollama 本地方案
  return new OllamaDocParserService(config);
}
