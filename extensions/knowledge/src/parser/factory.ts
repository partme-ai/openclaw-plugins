/**
 * @fileoverview DocParser 引擎工厂 — 非纯文本 ingest 可选节点。
 *
 * @description 支持 `zhipu`（layout_parsing）、`ollama`（VLM OCR）；默认 Ollama 本地。
 * **模块角色**：Knowledge Plugin · Parser adapter registry。
 *
 * @module knowledge/parser/factory
 */
import type { DocParserService, KnowledgeParserConfig } from '../types.js';
import { ZhipuDocParserService } from './zhipu.js';
import { OllamaDocParserService } from './ollama.js';

/**
 * @description 创建 {@link DocParserService}；无 provider 时默认 Ollama。
 *
 * @param config - 可选 Parser 配置。
 * @returns 文档解析服务实例。
 * @throws 未知 provider。
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
