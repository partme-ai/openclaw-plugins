/**
 * @fileoverview DocParser 引擎工厂 — 非纯文本 ingest 可选节点。
 *
 * @description 支持 `zhipu`（layout_parsing）、`ollama`（VLM OCR）；必须显式选择。
 * **模块角色**：Knowledge Plugin · Parser adapter registry。
 *
 * @module knowledge/parser/factory
 */
import type { DocParserService, KnowledgeParserConfig } from '../types.js';
import { ZhipuDocParserService } from './zhipu.js';
import { OllamaDocParserService } from './ollama.js';

/**
 * @description 创建 {@link DocParserService}；无 provider 时拒绝猜测文件出站路径。
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

  throw new Error('Parser provider is required. Supported: zhipu, ollama');
}
