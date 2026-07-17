import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashScopeEmbeddingService } from './dashscope.js';
import { QianfanEmbeddingService } from './qianfan.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function embeddingResponse(init: RequestInit, dimensions: number): Response {
  const input = (JSON.parse(String(init.body)) as { input: string[] }).input;
  return new Response(JSON.stringify({
    data: input.map((_, index) => ({ index, embedding: Array.from({ length: dimensions }, () => 0.01) })),
  }), { status: 200 });
}

describe('Embedding Provider 批次硬上限', () => {
  it('DashScope text-embedding-v4 即使使用默认配置也按最多 10 条拆批', async () => {
    const batchSizes: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      batchSizes.push((JSON.parse(String(init.body)) as { input: string[] }).input.length);
      return embeddingResponse(init, 1024);
    }));

    const result = await new DashScopeEmbeddingService({ provider: 'dashscope', apiKey: 'test-key' })
      .embedBatch(Array.from({ length: 11 }, (_, index) => `document-${index}`));

    expect(batchSizes).toEqual([10, 1]);
    expect(result).toHaveLength(11);
  });

  it('Qianfan embedding-v1 按官方最多 16 条拆批', async () => {
    const batchSizes: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      batchSizes.push((JSON.parse(String(init.body)) as { input: string[] }).input.length);
      return embeddingResponse(init, 384);
    }));

    const result = await new QianfanEmbeddingService({ provider: 'qianfan', apiKey: 'test-key' })
      .embedBatch(Array.from({ length: 17 }, (_, index) => `document-${index}`));

    expect(batchSizes).toEqual([16, 1]);
    expect(result).toHaveLength(17);
  });

  it('Qianfan tao-8k 每次只发送一个文本', async () => {
    const batchSizes: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      batchSizes.push((JSON.parse(String(init.body)) as { input: string[] }).input.length);
      return embeddingResponse(init, 1024);
    }));

    await new QianfanEmbeddingService({
      provider: 'qianfan',
      apiKey: 'test-key',
      model: 'tao-8k',
      dimensions: 1024,
    }).embedBatch(['one', 'two']);

    expect(batchSizes).toEqual([1, 1]);
  });
});
