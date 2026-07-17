import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteVecStore } from './sqlite-vec.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('SqliteVecStore integration', () => {
  it('persists vectors and FTS data across reopen', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'knowledge-sqlite-'));
    temporaryDirectories.push(directory);
    const dbPath = join(directory, 'knowledge.db');
    const first = new SqliteVecStore({ dbPath, namespace: 'tenant-a:bot', dimensions: 3 });
    await first.initialize();
    await first.upsert([{
      id: 'chunk-1',
      vector: [1, 0, 0],
      metadata: { sourceId: 'source-1', chunkIndex: 0, text: 'OpenClaw production knowledge' },
    }]);
    first.close();

    const reopened = new SqliteVecStore({ dbPath, namespace: 'tenant-a:bot', dimensions: 3 });
    await reopened.initialize();
    expect((await reopened.search([1, 0, 0], { topK: 1 }))[0]?.chunk.id).toBe('chunk-1');
    expect((await reopened.keywordSearch('OpenClaw', 1))[0]?.chunk.id).toBe('chunk-1');
    reopened.close();
  });

  it('does not collide sanitized namespace names', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'knowledge-sqlite-'));
    temporaryDirectories.push(directory);
    const dbPath = join(directory, 'knowledge.db');
    const colon = new SqliteVecStore({ dbPath, namespace: 'tenant:a', dimensions: 2 });
    const underscore = new SqliteVecStore({ dbPath, namespace: 'tenant_a', dimensions: 2 });
    await colon.initialize();
    await underscore.initialize();
    await colon.upsert([{ id: 'private', vector: [1, 0], metadata: { sourceId: 's', text: 'private' } }]);
    expect((await underscore.stats()).totalChunks).toBe(0);
    colon.close();
    underscore.close();
  });

  it('rolls back a failed source replacement and preserves the previous document', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'knowledge-sqlite-'));
    temporaryDirectories.push(directory);
    const store = new SqliteVecStore({
      dbPath: join(directory, 'knowledge.db'),
      namespace: 'tenant-a:bot',
      dimensions: 2,
    });
    await store.initialize();
    await store.upsert([{
      id: 'old-chunk',
      vector: [1, 0],
      metadata: { sourceId: 'source-1', chunkIndex: 0, text: 'previous document' },
    }]);

    const cyclicMetadata: Record<string, unknown> & { text: string; sourceId: string } = {
      sourceId: 'source-1',
      text: 'replacement document',
    };
    cyclicMetadata.self = cyclicMetadata;
    await expect(store.replaceBySource('source-1', [{
      id: 'new-chunk',
      vector: [0, 1],
      metadata: cyclicMetadata,
    }])).rejects.toThrow();

    const remaining = await store.search([1, 0], { sourceId: 'source-1', topK: 5 });
    expect(remaining.map((result) => result.chunk.id)).toEqual(['old-chunk']);
    expect((await store.keywordSearch('previous', 5, 'source-1')).map((result) => result.chunk.id)).toEqual(['old-chunk']);
    store.close();
  });
});
