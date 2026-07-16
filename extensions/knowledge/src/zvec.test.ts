/**
 * ZVec 存储后端测试
 */
import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cosineSimilarity } from './store/math.js';
import { ZVecStore } from './store/zvec.js';
import { namespaceDataPath } from './store/factory.js';
import type { VectorChunk } from '../types.js';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBe(1);
  });

  it('returns 0.5 for orthogonal vectors normalized', () => {
    // [1,0] vs [0,1]: dot=0, magnitude=1*1=1, (0/1+1)/2=0.5
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0.5);
  });

  it('throws on dimension mismatch', () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow();
  });
});

describe('ZVecStore', () => {
  function makeStore(): ZVecStore {
    return new ZVecStore({ namespace: 'test', dimensions: 3 });
  }

  function makeChunk(id: string, vector: number[], text: string, sourceId?: string): VectorChunk {
    return { id, vector, metadata: { text, sourceId: sourceId ?? 'doc1', chunkIndex: 0 } };
  }

  it('initializes and reports empty stats', async () => {
    const store = makeStore();
    await store.initialize();
    const stats = await store.stats();
    expect(stats.totalChunks).toBe(0);
    expect(stats.totalDocuments).toBe(0);
  });

  it('stores and retrieves chunks', async () => {
    const store = makeStore();
    await store.initialize();

    const chunk = makeChunk('c1', [1, 0, 0], 'hello world');
    await store.upsert([chunk]);

    const results = await store.search([1, 0, 0], { topK: 5 });
    expect(results.length).toBe(1);
    expect(results[0].chunk.metadata.text).toBe('hello world');
    expect(results[0].score).toBeCloseTo(1, 5);
  });

  it('rejects invalid dimensions and non-finite values before mutation', async () => {
    const store = makeStore();
    await store.initialize();
    await expect(store.upsert([makeChunk('bad-dim', [1, 0], 'bad')])).rejects.toThrow('dimensions mismatch');
    await expect(store.upsert([makeChunk('bad-value', [1, Number.NaN, 0], 'bad')])).rejects.toThrow('non-finite');
    expect((await store.stats()).totalChunks).toBe(0);
  });

  it('filters by sourceId', async () => {
    const store = makeStore();
    await store.initialize();

    await store.upsert([
      makeChunk('c1', [1, 0, 0], 'doc1 text', 'src1'),
      makeChunk('c2', [0, 1, 0], 'doc2 text', 'src2'),
    ]);

    const results = await store.search([1, 0, 0], { topK: 5, sourceId: 'src1' });
    expect(results.length).toBe(1);
    expect(results[0].chunk.metadata.sourceId).toBe('src1');
  });

  it('deletes by sourceId', async () => {
    const store = makeStore();
    await store.initialize();

    await store.upsert([
      makeChunk('c1', [1, 0, 0], 'text', 'src1'),
      makeChunk('c2', [0, 1, 0], 'text', 'src2'),
    ]);

    await store.deleteBySource('src1');
    const stats = await store.stats();
    expect(stats.totalChunks).toBe(1);
  });

  it('replaces one source without affecting other documents', async () => {
    const store = makeStore();
    await store.initialize();
    await store.upsert([
      makeChunk('old-1', [1, 0, 0], 'old text', 'src1'),
      makeChunk('other', [0, 1, 0], 'other text', 'src2'),
    ]);

    await store.replaceBySource('src1', [makeChunk('new-1', [0, 0, 1], 'new text', 'src1')]);

    expect((await store.search([0, 0, 1], { topK: 5, sourceId: 'src1' })).map((result) => result.chunk.id)).toEqual(['new-1']);
    expect((await store.search([0, 1, 0], { topK: 5, sourceId: 'src2' })).map((result) => result.chunk.id)).toEqual(['other']);
  });

  it('validates all replacement chunks before mutating the source', async () => {
    const store = makeStore();
    await store.initialize();
    await store.upsert([makeChunk('old-1', [1, 0, 0], 'old text', 'src1')]);

    await expect(store.replaceBySource('src1', [makeChunk('bad', [1, 0], 'bad', 'src1')])).rejects.toThrow('dimensions mismatch');
    expect((await store.search([1, 0, 0], { topK: 5, sourceId: 'src1' })).map((result) => result.chunk.id)).toEqual(['old-1']);
  });

  it('clears all data', async () => {
    const store = makeStore();
    await store.initialize();
    await store.upsert([makeChunk('c1', [1, 0, 0], 'text')]);
    await store.clear();
    const stats = await store.stats();
    expect(stats.totalChunks).toBe(0);
  });

  it('flushes pending writes during disposal using an owner-only file', async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'knowledge-zvec-')));
    const dbPath = join(directory, 'store.json');
    const store = new ZVecStore({ namespace: 'tenant-a:bot', dimensions: 3, dbPath, autoSaveIntervalMs: 60_000 });
    await store.initialize();
    await store.upsert([makeChunk('c1', [1, 0, 0], 'persisted')]);
    await store.dispose();

    const persisted = JSON.parse(await readFile(dbPath, 'utf8')) as VectorChunk[];
    expect(persisted).toHaveLength(1);
    expect(persisted[0].id).toBe('c1');
  });

  it('derives collision-resistant persistence files per namespace', () => {
    const base = '/tmp/knowledge.json';
    expect(namespaceDataPath(base, 'tenant-a:bot')).not.toBe(namespaceDataPath(base, 'tenant_a_bot'));
    expect(namespaceDataPath(base, 'tenant-a:bot')).toMatch(/knowledge-[a-f0-9]{12}\.json$/);
  });
});
