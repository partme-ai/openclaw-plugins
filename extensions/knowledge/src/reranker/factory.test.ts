/**
 * Reranker 工厂测试
 *
 * 覆盖 provider 路由和默认行为。
 */
import { describe, it, expect, vi } from 'vitest';

// Mock ZhipuRerankerService
vi.mock('./zhipu.js', () => {
  function MockZhipuRerankerService() {
    return {
      modelName: 'rerank',
      rerank: vi.fn().mockResolvedValue([
        { text: 'doc A', index: 0, score: 0.95 },
        { text: 'doc B', index: 1, score: 0.85 },
      ]),
      health: vi.fn().mockResolvedValue(true),
    };
  }
  return {
    ZhipuRerankerService: vi.fn().mockImplementation(MockZhipuRerankerService),
  };
});

// Mock JinaRerankerService
vi.mock('./jina.js', () => {
  function MockJinaRerankerService() {
    return {
      modelName: 'jina-reranker-v2-base-multilingual',
      rerank: vi.fn().mockResolvedValue([
        { text: '', index: 0, score: 0.92 },
        { text: '', index: 1, score: 0.78 },
      ]),
      health: vi.fn().mockResolvedValue(true),
    };
  }
  return {
    JinaRerankerService: vi.fn().mockImplementation(MockJinaRerankerService),
  };
});

// Mock ollama SDK
vi.mock('ollama', () => {
  return {
    default: {
      chat: vi.fn().mockResolvedValue({
        message: {
          content: '{"results": [{"index": 0, "score": 0.98}, {"index": 1, "score": 0.75}]}',
        },
      }),
    },
  };
});

// Mock OllamaRerankerService (uses ollama SDK internally)
vi.mock('./ollama.js', () => {
  function MockOllamaRerankerService() {
    return {
      modelName: 'dengcao/Qwen3-Reranker-4B:Q4_K_M',
      rerank: vi.fn().mockResolvedValue([
        { text: 'doc A', index: 0, score: 0.98 },
        { text: 'doc B', index: 1, score: 0.75 },
      ]),
      health: vi.fn().mockResolvedValue(true),
    };
  }
  return {
    OllamaRerankerService: vi.fn().mockImplementation(MockOllamaRerankerService),
  };
});

const { createRerankerService } = await import('./factory.js');

describe('createRerankerService', () => {
  describe('provider 路由', () => {
    it('provider=zhipu → ZhipuRerankerService', () => {
      const svc = createRerankerService({ provider: 'zhipu', apiKey: 'test-key' });
      expect(svc.modelName).toBe('rerank');
    });

    it('provider=jina → JinaRerankerService', () => {
      const svc = createRerankerService({ provider: 'jina', apiKey: 'test-key' });
      expect(svc.modelName).toBe('jina-reranker-v2-base-multilingual');
    });

    it('provider=ollama → OllamaRerankerService', () => {
      const svc = createRerankerService({ provider: 'ollama' });
      expect(svc.modelName).toBe('dengcao/Qwen3-Reranker-4B:Q4_K_M');
    });

    it('无 provider → 默认 OllamaRerankerService', () => {
      const svc = createRerankerService();
      expect(svc.modelName).toBe('dengcao/Qwen3-Reranker-4B:Q4_K_M');
    });
  });

  describe('provider 大小写不敏感', () => {
    it('provider=ZHIPU → 正确路由', () => {
      const svc = createRerankerService({ provider: 'ZHIPU', apiKey: 'test-key' });
      expect(svc.modelName).toBe('rerank');
    });

    it('provider=Jina → 正确路由', () => {
      const svc = createRerankerService({ provider: 'Jina', apiKey: 'test-key' });
      expect(svc.modelName).toBe('jina-reranker-v2-base-multilingual');
    });

    it('provider=Ollama → 正确路由', () => {
      const svc = createRerankerService({ provider: 'Ollama' });
      expect(svc.modelName).toBe('dengcao/Qwen3-Reranker-4B:Q4_K_M');
    });
  });

  describe('未知 provider', () => {
    it('抛 Error', () => {
      expect(() => createRerankerService({ provider: 'unknown' })).toThrow('Unknown reranker provider');
    });
  });

  describe('基本功能', () => {
    it('rerank 返回排序结果', async () => {
      const svc = createRerankerService({ provider: 'zhipu', apiKey: 'test-key' });
      const results = await svc.rerank('query', ['doc A', 'doc B']);
      expect(results).toHaveLength(2);
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    it('health 返回 true', async () => {
      const svc = createRerankerService({ provider: 'ollama' });
      const healthy = await svc.health();
      expect(healthy).toBe(true);
    });
  });
});
