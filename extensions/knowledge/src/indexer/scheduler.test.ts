import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ZVecStore } from '../store/zvec.js';
import { indexDocument, loadDocument, withSourceWriteLock, withStoreExclusiveWriteLock } from './scheduler.js';

describe('withSourceWriteLock', () => {
  it('serializes writes for the same source in invocation order', async () => {
    const store = new ZVecStore({ namespace: 'test', dimensions: 2 });
    await store.initialize();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withSourceWriteLock(store, 'source-1', async () => {
      events.push('first:start');
      await firstGate;
      events.push('first:end');
    });
    const second = withSourceWriteLock(store, 'source-1', async () => {
      events.push('second:start');
      events.push('second:end');
    });

    await vi.waitFor(() => expect(events).toEqual(['first:start']));
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('allows unrelated sources to write concurrently', async () => {
    const store = new ZVecStore({ namespace: 'test', dimensions: 2 });
    await store.initialize();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withSourceWriteLock(store, 'source-1', async () => {
      events.push('first:start');
      await firstGate;
    });
    const second = withSourceWriteLock(store, 'source-2', async () => {
      events.push('second:start');
    });

    await Promise.resolve();
    await second;
    expect(events).toEqual(['first:start', 'second:start']);
    releaseFirst();
    await first;
  });

  it('orders namespace clear between earlier and later source mutations', async () => {
    const store = new ZVecStore({ namespace: 'test', dimensions: 2 });
    await store.initialize();
    const events: string[] = [];
    let releaseFirst!: () => void;
    let releaseClear!: () => void;
    let markQueuedStarted!: () => void;
    let markClearStarted!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const clearGate = new Promise<void>((resolve) => { releaseClear = resolve; });
    const queuedStarted = new Promise<void>((resolve) => { markQueuedStarted = resolve; });
    const clearStarted = new Promise<void>((resolve) => { markClearStarted = resolve; });

    const first = withSourceWriteLock(store, 'source-1', async () => {
      events.push('first:start');
      await firstGate;
      events.push('first:end');
    });
    const queuedBeforeClear = withSourceWriteLock(store, 'source-1', async () => {
      events.push('queued-before-clear');
      markQueuedStarted();
    });
    const clear = withStoreExclusiveWriteLock(store, async () => {
      events.push('clear:start');
      markClearStarted();
      await clearGate;
      events.push('clear:end');
    });
    const afterClear = withSourceWriteLock(store, 'source-2', async () => {
      events.push('after-clear');
    });

    await vi.waitFor(() => expect(events).toEqual(['first:start']));
    releaseFirst();
    await queuedStarted;
    await clearStarted;
    expect(events).toEqual(['first:start', 'first:end', 'queued-before-clear', 'clear:start']);
    releaseClear();
    await Promise.all([first, queuedBeforeClear, clear, afterClear]);
    expect(events).toEqual([
      'first:start', 'first:end', 'queued-before-clear', 'clear:start', 'clear:end', 'after-clear',
    ]);
  });

  it('preserves the previous source index when replacement input is empty', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'knowledge-empty-'));
    try {
      const filePath = join(directory, 'empty.md');
      await writeFile(filePath, '   \n');
      const store = new ZVecStore({ namespace: 'test', dimensions: 2 });
      await store.initialize();
      await store.replaceBySource('source-1', [{
        id: 'old', vector: [1, 0], metadata: { sourceId: 'source-1', chunkIndex: 0, text: 'old' },
      }]);
      const embedding = {
        dimensions: 2,
        modelName: 'test',
        embed: async () => [1, 0],
        embedBatch: async () => [],
        health: async () => true,
      };

      await expect(indexDocument(filePath, 'source-1', embedding, store)).resolves.toMatchObject({
        success: false,
        error: expect.stringContaining('existing index was preserved'),
      });
      await expect(store.stats()).resolves.toMatchObject({ totalChunks: 1, totalDocuments: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('loadDocument', () => {
  it('reads .text files as plain UTF-8 without requiring a parser', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'knowledge-text-'));
    try {
      const filePath = join(directory, 'notes.text');
      await writeFile(filePath, '可直接索引的文本');
      await expect(loadDocument(filePath)).resolves.toBe('可直接索引的文本');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
