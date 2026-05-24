/**
 * @fileoverview tiktoken 本地 Tokenizer — 零网络 token 计数/截断。
 *
 * **模块角色**：Knowledge Plugin · Tokenizer provider (tiktoken)。
 *
 * @module knowledge/tokenizer/tiktoken
 */
import { get_encoding, type Tiktoken, type TiktokenEncoding } from 'tiktoken';
import type { TokenizerService, KnowledgeTokenizerConfig } from '../types.js';

/** 默认编码 */
const DEFAULT_ENCODING: TiktokenEncoding = 'o200k_base';

export class TikTokenTokenizerService implements TokenizerService {
  readonly modelName: string;
  private encodingName: TiktokenEncoding;
  private encoder: Tiktoken | null = null;

  constructor(config?: KnowledgeTokenizerConfig) {
    this.encodingName = toTiktokenEncoding(config?.model);
    this.modelName = `tiktoken:${this.encodingName}`;
  }

  private async getEncoder(): Promise<Tiktoken> {
    if (!this.encoder) {
      this.encoder = get_encoding(this.encodingName);
    }
    return this.encoder;
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

function toTiktokenEncoding(value: string | undefined): TiktokenEncoding {
  switch (value) {
    case 'gpt2':
    case 'r50k_base':
    case 'p50k_base':
    case 'p50k_edit':
    case 'cl100k_base':
    case 'o200k_base':
      return value;
    default:
      return DEFAULT_ENCODING;
  }
}
