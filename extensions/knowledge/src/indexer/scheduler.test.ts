import { describe, expect, it } from 'vitest';
import { ZVecStore } from '../store/zvec.js';
import { withSourceWriteLock } from './scheduler.js';

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

    await Promise.resolve();
    expect(events).toEqual(['first:start']);
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
});
