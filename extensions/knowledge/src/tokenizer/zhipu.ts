/**
 * @fileoverview 智谱 Tokenizer API — 远程精确 token 计数。
 *
 * **模块角色**：Knowledge Plugin · Tokenizer provider (Zhipu)。
 *
 * @module knowledge/tokenizer/zhipu
 */
import type { TokenizerService, KnowledgeTokenizerConfig } from '../types.js';
import { requestProviderJson } from '../shared/provider-http.js';

/** 默认模型 */
const DEFAULT_MODEL = 'glm-4.6';
/** 智谱 Tokenizer API 端点 */
const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4/tokenizer';

/**
 * 智谱远程 Tokenizer 适配器。
 *
 * 使用服务端模型获得精确 token 数；截断时通过二分搜索多次计数逼近预算，因此比
 * 本地 tiktoken 延迟更高，适用于必须与智谱模型口径完全一致的场景。
 */
export class ZhipuTokenizerService implements TokenizerService {
  readonly modelName: string;
  private baseUrl: string;
  private apiKey: string;
  private config?: KnowledgeTokenizerConfig;

  constructor(config?: KnowledgeTokenizerConfig) {
    this.config = config;
    this.baseUrl = config?.baseUrl ?? DEFAULT_BASE_URL;
    this.apiKey = config?.apiKey ?? '';
    this.modelName = config?.model ?? DEFAULT_MODEL;
  }

  async countTokens(text: string): Promise<number> {
    if (!this.apiKey) {
      throw new Error('Zhipu Tokenizer requires apiKey');
    }

    const body = {
      model: this.modelName,
      messages: [{ role: 'user' as const, content: text }],
    };

    const data = await requestProviderJson<{ usage?: { prompt_tokens?: unknown; total_tokens?: unknown } }>(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    }, {
      timeoutMs: this.config?.requestTimeoutMs,
      maxRetries: this.config?.maxRetries,
      maxResponseBytes: this.config?.maxResponseBytes ?? 1024 * 1024,
    }, 'Zhipu', 'Tokenizer');

    const count = data.usage?.prompt_tokens ?? data.usage?.total_tokens;
    if (!Number.isSafeInteger(count) || (count as number) < 0) {
      throw new Error('Zhipu Tokenizer returned an invalid token count');
    }
    return count as number;
  }

  async truncate(text: string, maxTokens: number): Promise<string> {
    // 先精确计数
    const count = await this.countTokens(text);
    if (count <= maxTokens) return text;

    // 远程 API 不支持截断，按比例估算后尝试
    // 使用二分法逼近目标 token 数
    const chars = [...text];
    let lo = 0;
    let hi = chars.length;

    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const snippet = chars.slice(0, mid).join('');
      const snippetTokens = await this.countTokens(snippet);
      if (snippetTokens <= maxTokens) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }

    return chars.slice(0, lo).join('');
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
