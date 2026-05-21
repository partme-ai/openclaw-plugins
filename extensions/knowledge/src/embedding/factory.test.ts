/**
 * Embedding 工厂测试 — 覆盖所有 8 个 provider 分支
 *
 * 使用 vitest mock 避免真实网络请求。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEmbeddingService } from './factory.js';

// Mock OpenAI — 使用 function 而非 arrow 以支持 new
vi.mock('./openai.js', () => {
  function MockOpenAIEmbeddingService() {
    return {
      dimensions: 1536,
      modelName: 'text-embedding-ada-002',
      embed: vi.fn().mockResolvedValue(new Array(1536).fill(0.5)),
      embedBatch: vi.fn().mockResolvedValue([new Array(1536).fill(0.5)]),
      health: vi.fn().mockResolvedValue(true),
    };
  }
  return {
    OpenAIEmbeddingService: vi.fn().mockImplementation(MockOpenAIEmbeddingService),
  };
});

// Mock DashScope
vi.mock('./dashscope.js', () => {
  function MockDashScopeEmbeddingService() {
    return {
      dimensions: 1024,
      modelName: 'text-embedding-v3',
      embed: vi.fn().mockResolvedValue(new Array(1024).fill(0.1)),
      embedBatch: vi.fn().mockResolvedValue([new Array(1024).fill(0.1)]),
      health: vi.fn().mockResolvedValue(true),
    };
  }
  return {
    DashScopeEmbeddingService: vi.fn().mockImplementation(MockDashScopeEmbeddingService),
  };
});

// Mock Zhipu
vi.mock('./zhipu.js', () => {
  function MockZhipuEmbeddingService() {
    return {
      dimensions: 2048,
      modelName: 'embedding-3',
      embed: vi.fn().mockResolvedValue(new Array(2048).fill(0.2)),
      embedBatch: vi.fn().mockResolvedValue([new Array(2048).fill(0.2)]),
      health: vi.fn().mockResolvedValue(true),
    };
  }
  return {
    ZhipuEmbeddingService: vi.fn().mockImplementation(MockZhipuEmbeddingService),
  };
});

// Mock Qianfan
vi.mock('./qianfan.js', () => {
  function MockQianfanEmbeddingService() {
    return {
      dimensions: 384,
      modelName: 'embedding-v1',
      embed: vi.fn().mockResolvedValue(new Array(384).fill(0.5)),
      embedBatch: vi.fn().mockResolvedValue([new Array(384).fill(0.5)]),
      health: vi.fn().mockResolvedValue(true),
    };
  }
  return {
    QianfanEmbeddingService: vi.fn().mockImplementation(MockQianfanEmbeddingService),
  };
});

// Mock Ollama
vi.mock('./ollama.js', () => {
  function MockOllamaEmbeddingService() {
    return {
      dimensions: 768,
      modelName: 'embeddinggemma',
      embed: vi.fn().mockResolvedValue(new Array(768).fill(0.7)),
      embedBatch: vi.fn().mockResolvedValue([new Array(768).fill(0.7)]),
      health: vi.fn().mockResolvedValue(true),
    };
  }
  return {
    OllamaEmbeddingService: vi.fn().mockImplementation(MockOllamaEmbeddingService),
  };
});

describe('createEmbeddingService (multi-provider routing)', () => {
  // --------------------------------------------------
  // 精确 provider 路由
  // --------------------------------------------------
  describe('精确 provider 路由', () => {
    it('provider=openai → OpenAIEmbeddingService', () => {
      const svc = createEmbeddingService({ provider: 'openai', apiKey: 'sk-test' });
      expect(svc.modelName).toBe('text-embedding-ada-002');
      expect(svc.dimensions).toBe(1536);
    });

    it('provider=dashscope → DashScopeEmbeddingService', () => {
      const svc = createEmbeddingService({ provider: 'dashscope', apiKey: 'sk-test' });
      expect(svc.modelName).toBe('text-embedding-v3');
      expect(svc.dimensions).toBe(1024);
    });

    it('provider=zhipu → ZhipuEmbeddingService', () => {
      const svc = createEmbeddingService({ provider: 'zhipu', apiKey: 'sk-test' });
      expect(svc.modelName).toBe('embedding-3');
      expect(svc.dimensions).toBe(2048);
    });

    it('provider=qianfan → QianfanEmbeddingService', () => {
      const svc = createEmbeddingService({ provider: 'qianfan', apiKey: 'bce-v3/ALTAK-xxx' });
      expect(svc.modelName).toBe('embedding-v1');
      expect(svc.dimensions).toBe(384);
    });

    it('provider=ollama → OllamaEmbeddingService', () => {
      const svc = createEmbeddingService({ provider: 'ollama' });
      expect(svc.modelName).toBe('embeddinggemma');
      expect(svc.dimensions).toBe(768);
    });
  });

  // --------------------------------------------------
  // 未知 provider 抛出异常
  // --------------------------------------------------
  describe('未知 provider', () => {
    it('未知 provider 抛 Error', () => {
      expect(() => createEmbeddingService({ provider: 'unknown-provider' })).toThrow('Unknown embedding provider');
    });
  });

  // --------------------------------------------------
  // 向后兼容：无 provider 时的嗅探
  // --------------------------------------------------
  describe('向后兼容 (无 provider 嗅探)', () => {
    it('有 apiKey 无 provider → OpenAIEmbeddingService', () => {
      const svc = createEmbeddingService({ apiKey: 'sk-test-key' });
      expect(svc.modelName).toBe('text-embedding-ada-002');
    });

    it('apiKey 有空白前缀也能正确识别', () => {
      const svc = createEmbeddingService({ apiKey: '  sk-test-key' });
      expect(svc.modelName).toBe('text-embedding-ada-002');
    });
  });

  // --------------------------------------------------
  // 无 provider 无 apiKey 抛出错误（替代旧的降级逻辑）
  // --------------------------------------------------
  describe('无 provider 无 apiKey 抛出错误', () => {
    it('apiKey 为 undefined 时抛出错误', () => {
      expect(() => createEmbeddingService({})).toThrow(
        'No embedding provider configured'
      );
    });

    it('apiKey 为空字符串时抛出错误', () => {
      expect(() => createEmbeddingService({ apiKey: '' })).toThrow(
        'No embedding provider configured'
      );
    });

    it('不传 config 时抛出错误', () => {
      expect(() => createEmbeddingService()).toThrow(
        'No embedding provider configured'
      );
    });

    it('apiKey 为全空白字符串时抛出错误', () => {
      expect(() => createEmbeddingService({ apiKey: '   ' })).toThrow(
        'No embedding provider configured'
      );
    });
  });

  // --------------------------------------------------
  // provider 大小写不敏感
  // --------------------------------------------------
  describe('provider 大小写不敏感', () => {
    it('provider=OpenAI → 正确路由', () => {
      const svc = createEmbeddingService({ provider: 'OpenAI', apiKey: 'sk-test' });
      expect(svc.modelName).toBe('text-embedding-ada-002');
    });

    it('provider=DASHSCOPE → 正确路由', () => {
      const svc = createEmbeddingService({ provider: 'DASHSCOPE', apiKey: 'sk-test' });
      expect(svc.modelName).toBe('text-embedding-v3');
    });

    it('provider=Ollama → 正确路由', () => {
      const svc = createEmbeddingService({ provider: 'Ollama' });
      expect(svc.modelName).toBe('embeddinggemma');
    });
  });
});
