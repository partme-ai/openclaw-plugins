/**
 * Tokenizer 工厂测试
 *
 * 覆盖 provider 路由和默认行为。
 * tiktoken 使用 mock 避免实际加载编码文件。
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';

// Mock tiktoken — 返回 mock 编码器
vi.mock('tiktoken', () => {
  function MockEncoder() {
    return {
      encode: (text: string) => {
        // 模拟编码：按空白分隔，每个单词算一个 token
        const words = text.split(/\s+/).filter(Boolean);
        return new Array(words.length).fill(0).map((_, i) => i);
      },
      decode: (tokens: number[]) => {
        // 解码不做精确还原，返回占位文本
        return new TextEncoder().encode('x'.repeat(tokens.length));
      },
      free: vi.fn(),
    };
  }
  return {
    get_encoding: vi.fn().mockReturnValue(new MockEncoder()),
  };
});

// 需要在 mock 之后 import，否则 hoist 问题
const mod = await import('./factory.js');
const { createTokenizerService } = mod;

import type { TokenizerService, KnowledgeTokenizerConfig } from '../types.js';

describe('createTokenizerService', () => {
  describe('provider 路由', () => {
    it('provider=tiktoken → TikTokenTokenizerService', () => {
      const svc = createTokenizerService({ provider: 'tiktoken' });
      expect(svc.modelName).toContain('tiktoken');
    });

    it('provider=zhipu → ZhipuTokenizerService', () => {
      const svc = createTokenizerService({ provider: 'zhipu', apiKey: 'test-key' });
      expect(svc.modelName).toBe('glm-4.6');
    });

    it('无 provider → 默认 TikTokenTokenizerService', () => {
      const svc = createTokenizerService();
      expect(svc.modelName).toContain('tiktoken');
    });

    it('空 provider → 默认 TikTokenTokenizerService', () => {
      const svc = createTokenizerService({ provider: '' });
      expect(svc.modelName).toContain('tiktoken');
    });
  });

  describe('provider 大小写不敏感', () => {
    it('provider=TikToken → 正确路由', () => {
      const svc = createTokenizerService({ provider: 'TikToken' });
      expect(svc.modelName).toContain('tiktoken');
    });

    it('provider=ZHIPU → 正确路由', () => {
      const svc = createTokenizerService({ provider: 'ZHIPU', apiKey: 'test-key' });
      expect(svc.modelName).toBe('glm-4.6');
    });
  });

  describe('未知 provider', () => {
    it('抛 Error', () => {
      expect(() => createTokenizerService({ provider: 'unknown' })).toThrow('Unknown tokenizer provider');
    });
  });

  describe('TikTokenTokenizerService 功能', () => {
    it('countTokens 返回正数', async () => {
      const svc = createTokenizerService({ provider: 'tiktoken' });
      const count = await svc.countTokens('hello world');
      expect(count).toBeGreaterThan(0);
    });

    it('truncate 短文本不截断', async () => {
      const svc = createTokenizerService({ provider: 'tiktoken' });
      const result = await svc.truncate('short', 100);
      expect(result).toBe('short');
    });

    it('health 返回 true', async () => {
      const svc = createTokenizerService({ provider: 'tiktoken' });
      const healthy = await svc.health();
      expect(healthy).toBe(true);
    });
  });
});
