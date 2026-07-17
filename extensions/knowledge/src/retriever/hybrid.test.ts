import { describe, expect, it, vi } from 'vitest';
import { hybridSearch } from './hybrid.js';
import type { EmbeddingService, VectorChunk, VectorStore } from '../types.js';

const chunk = (id: string, text: string): VectorChunk => ({
  id,
  vector: [1, 0, 0],
  metadata: { sourceId: 'source', chunkIndex: 0, text },
});

const embedding: EmbeddingService = {
  dimensions: 3,
  modelName: 'test',
  embed: vi.fn(async () => [1, 0, 0]),
  embedBatch: vi.fn(async () => [[1, 0, 0]]),
  health: vi.fn(async () => true),
};

function store(overrides: Partial<VectorStore> = {}): VectorStore {
  return {
    initialize: vi.fn(async () => undefined),
    upsert: vi.fn(async () => undefined),
    upsertBatch: vi.fn(async () => undefined),
    search: vi.fn(async () => []),
    deleteBySource: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
    stats: vi.fn(async () => ({ totalChunks: 0, totalDocuments: 0, provider: 'test', dimensions: 3 })),
    ...overrides,
  };
}

describe('hybridSearch', () => {
  it('uses the store dimension for the keyword fallback scan', async () => {
    const search = vi.fn(async (vector: number[]) => [{ chunk: chunk('1', 'hello world'), score: 1 }]);
    const vectorStore = store({ search });

    const results = await hybridSearch('hello', embedding, vectorStore, {
      topK: 5,
      config: { strategy: 'keyword' },
    });

    expect(search).toHaveBeenCalledWith(expect.arrayContaining([0, 0, 0]), expect.any(Object));
    expect(search.mock.calls[0][0]).toHaveLength(3);
    expect(results).toHaveLength(1);
  });

  it('applies minScore to the final fused score instead of the vector recall', async () => {
    const vectorStore = store({
      search: vi.fn(async () => [{ chunk: chunk('1', 'unmatched'), score: 0.5 }]),
      keywordSearch: vi.fn(async () => []),
    });

    const results = await hybridSearch('query', embedding, vectorStore, {
      topK: 5,
      minScore: 0.4,
      config: { strategy: 'hybrid', vectorWeight: 0.7, keywordWeight: 0.3 },
    });

    expect(vectorStore.search).toHaveBeenCalledWith([1, 0, 0], expect.objectContaining({ minScore: 0 }));
    expect(results).toEqual([]);
  });
});
