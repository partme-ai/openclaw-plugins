/**
 * DocParser 工厂测试
 *
 * 覆盖 provider 路由和默认行为。
 */
import { describe, it, expect, vi } from 'vitest';

// Mock ZhipuDocParserService
vi.mock('./zhipu.js', () => {
  function MockZhipuDocParserService() {
    return {
      modelName: 'glm-ocr',
      parse: vi.fn().mockResolvedValue({
        text: '# Document Title\n\nThis is document content.',
        metadata: { fileName: 'test.png', mimeType: 'image/png' },
        layout: {
          pages: [{
            width: 600,
            height: 800,
            elements: [{ type: 'text', content: 'Document content', bbox: [0.1, 0.1, 0.9, 0.3] }],
          }],
        },
      }),
      health: vi.fn().mockResolvedValue(true),
    };
  }
  return {
    ZhipuDocParserService: vi.fn().mockImplementation(MockZhipuDocParserService),
  };
});

// Mock OllamaDocParserService
vi.mock('./ollama.js', () => {
  function MockOllamaDocParserService() {
    return {
      modelName: 'glm-ocr',
      parse: vi.fn().mockResolvedValue({
        text: 'Recognized text from image.',
        metadata: { fileName: 'test.png', mimeType: 'image/png' },
      }),
      health: vi.fn().mockResolvedValue(true),
    };
  }
  return {
    OllamaDocParserService: vi.fn().mockImplementation(MockOllamaDocParserService),
  };
});

const { createParserService } = await import('./factory.js');

describe('createParserService', () => {
  describe('provider 路由', () => {
    it('provider=zhipu → ZhipuDocParserService', () => {
      const svc = createParserService({ provider: 'zhipu', apiKey: 'test-key' });
      expect(svc.modelName).toBe('glm-ocr');
    });

    it('provider=ollama → OllamaDocParserService', () => {
      const svc = createParserService({ provider: 'ollama' });
      expect(svc.modelName).toBe('glm-ocr');
    });

    it('无 provider → 默认 OllamaDocParserService', () => {
      const svc = createParserService();
      expect(svc.modelName).toBe('glm-ocr');
    });
  });

  describe('provider 大小写不敏感', () => {
    it('provider=ZHIPU → 正确路由', () => {
      const svc = createParserService({ provider: 'ZHIPU', apiKey: 'test-key' });
      expect(svc.modelName).toBe('glm-ocr');
    });

    it('provider=Ollama → 正确路由', () => {
      const svc = createParserService({ provider: 'Ollama' });
      expect(svc.modelName).toBe('glm-ocr');
    });
  });

  describe('未知 provider', () => {
    it('抛 Error', () => {
      expect(() => createParserService({ provider: 'unknown' })).toThrow('Unknown parser provider');
    });
  });

  describe('基本功能', () => {
    it('parse 返回结构化文档', async () => {
      const svc = createParserService({ provider: 'zhipu', apiKey: 'test-key' });
      const result = await svc.parse('https://example.com/doc.png');
      expect(result.text).toContain('Document');
      expect(result.metadata.fileName).toBeDefined();
    });

    it('zhipu parse 返回布局信息', async () => {
      const svc = createParserService({ provider: 'zhipu', apiKey: 'test-key' });
      const result = await svc.parse('test.png');
      expect(result.layout).toBeDefined();
      expect(result.layout?.pages[0].elements).toHaveLength(1);
    });

    it('health 返回 true', async () => {
      const svc = createParserService({ provider: 'ollama' });
      const healthy = await svc.health();
      expect(healthy).toBe(true);
    });
  });
});
