import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeConfig, VectorStore } from '../types.js';

const mocks = vi.hoisted(() => ({
  createVectorStore: vi.fn(),
  createEmbeddingService: vi.fn(() => ({
    dimensions: 3,
    modelName: 'fixture',
    embed: vi.fn(),
    embedBatch: vi.fn(),
    health: vi.fn(),
  })),
}));

vi.mock('../store/factory.js', () => ({
  createVectorStore: mocks.createVectorStore,
  getDefaultStoreConfig: (namespace: string) => ({ provider: 'sqlite-vec', namespace }),
}));
vi.mock('../embedding/factory.js', () => ({ createEmbeddingService: mocks.createEmbeddingService }));

import { getOrCreateStore, invalidateStoreCache } from './hooks.js';

function store(): VectorStore {
  return {
    initialize: vi.fn(),
    add: vi.fn(),
    addBatch: vi.fn(),
    search: vi.fn(),
    keywordSearch: vi.fn(),
    delete: vi.fn(),
    deleteBySource: vi.fn(),
    replaceBySource: vi.fn(),
    clear: vi.fn(),
    stats: vi.fn(),
    close: vi.fn(),
  };
}

function config(dimensions: number): KnowledgeConfig {
  return {
    enabled: true,
    embedding: { provider: 'ollama', model: `fixture-${dimensions}`, dimensions },
  };
}

describe('getOrCreateStore 生命周期', () => {
  beforeEach(async () => {
    await invalidateStoreCache();
    mocks.createVectorStore.mockReset();
  });

  it('配置切换失败后不缓存已经关闭的旧 Store', async () => {
    const first = store();
    const third = store();
    mocks.createVectorStore
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error('fixture initialization failed'))
      .mockResolvedValueOnce(third);

    await expect(getOrCreateStore(config(3), 'session-fixture:agent')).resolves.toMatchObject({ store: first });
    await expect(getOrCreateStore(config(4), 'session-fixture:agent')).rejects.toThrow('fixture initialization failed');
    expect(first.close).toHaveBeenCalledOnce();

    await expect(getOrCreateStore(config(5), 'session-fixture:agent')).resolves.toMatchObject({ store: third });
    expect(mocks.createVectorStore).toHaveBeenCalledTimes(3);
  });
});
