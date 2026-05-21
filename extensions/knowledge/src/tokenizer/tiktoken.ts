/**
 * TikTokToken — 基于 tiktoken 的本地 Tokenizer 实现
 *
 * 使用 tiktoken 开源库在本地计算 token 数量，无需网络调用。
 * 默认编码 o200k_base 与 GLM-4 系列和 OpenAI 模型兼容。
 *
 * 智谱 Tokenizer API 文档: https://docs.bigmodel.cn/api-reference/模型-api/文本分词器
 */
import { get_encoding, type Tiktoken } from 'tiktoken';
import type { TokenizerService, KnowledgeTokenizerConfig } from '../types.js';

/** 默认编码 */
const DEFAULT_ENCODING = 'o200k_base';

export class TikTokenTokenizerService implements TokenizerService {
  readonly modelName: string;
  private encodingName: string;
  private encPromise: Promise<Tiktoken> | null = null;

  constructor(config?: KnowledgeTokenizerConfig) {
    this.encodingName = config?.model ?? DEFAULT_ENCODING;
    this.modelName = `tiktoken:${this.encodingName}`;
  }

  private async getEncoder(): Promise<Tiktoken> {
    if (!this.encPromise) {
      this.encPromise = get_encoding(this.encodingName);
    }
    return this.encPromise;
  }

  async countTokens(text: string): Promise<number> {
    const enc = await this.getEncoder();
    const tokens = enc.encode(text);
    return tokens.length;
  }

  async truncate(text: string, maxTokens: number): Promise<string> {
    const enc = await this.getEncoder();
    const tokens = enc.encode(text);
    if (tokens.length <= maxTokens) return text;
    const truncated = tokens.slice(0, maxTokens);
    return new TextDecoder().decode(enc.decode(truncated));
  }

  async health(): Promise<boolean> {
    try {
      const count = await this.countTokens('health check');
      return count > 0;
    } catch {
      return false;
    }
  }
}
