/**
 * ZhipuTokenizerService — 智谱 AI Tokenizer API 实现（远程方案）
 *
 * 调用智谱 AI 的 tokenizer API 准确计算指定模型下的 token 消耗。
 * 适用于需要精确匹配特定模型（如 glm-4.6、glm-4-flash）token 划分的场景。
 *
 * API: POST https://open.bigmodel.cn/api/paas/v4/tokenizer
 * 文档: https://docs.bigmodel.cn/api-reference/模型-api/文本分词器
 */
import type { TokenizerService, KnowledgeTokenizerConfig } from '../types.js';

/** 默认模型 */
const DEFAULT_MODEL = 'glm-4.6';
/** 智谱 Tokenizer API 端点 */
const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4/tokenizer';

export class ZhipuTokenizerService implements TokenizerService {
  readonly modelName: string;
  private baseUrl: string;
  private apiKey: string;

  constructor(config?: KnowledgeTokenizerConfig) {
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

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown');
      throw new Error(`Zhipu Tokenizer API error: ${response.status} — ${errorText}`);
    }

    const data = (await response.json()) as {
      usage: { prompt_tokens: number; total_tokens: number };
    };

    return data.usage?.prompt_tokens ?? data.usage?.total_tokens ?? 0;
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
