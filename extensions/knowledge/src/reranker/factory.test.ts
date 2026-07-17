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

    it('无 provider → 拒绝猜测外部服务', () => {
      expect(() => createRerankerService()).toThrow('provider is required');
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
      const svc = createRerankerService({ provider: 'jina', apiKey: 'test-key' });
      const healthy = await svc.health();
      expect(healthy).toBe(true);
    });
  });
});
