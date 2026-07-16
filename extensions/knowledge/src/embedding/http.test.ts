import { afterEach, describe, expect, it, vi } from 'vitest';
import { inEmbeddingBatches, postEmbeddingJson, validateEmbeddingData } from './http.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('embedding HTTP guardrails', () => {
  it('splits large requests while preserving result order', async () => {
    const seen: string[][] = [];
    const result = await inEmbeddingBatches(['a', 'b', 'c', 'd', 'e'], { maxBatchSize: 2 }, async (batch) => {
      seen.push(batch);
      return batch.map((value) => value.toUpperCase());
    });

    expect(seen).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
    expect(result).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('retries a transient server error and returns JSON', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('temporary', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ data: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(postEmbeddingJson('https://embedding.test', { method: 'POST' }, {
      requestTimeoutMs: 1_000,
      maxRetries: 1,
    }, 'Test')).resolves.toEqual({ data: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects missing, duplicate, non-finite, and wrong-dimension vectors', () => {
    expect(() => validateEmbeddingData(undefined, 1, 2, 'Test')).toThrow('expected 1');
    expect(() => validateEmbeddingData([
      { index: 0, embedding: [1, 0] },
      { index: 0, embedding: [0, 1] },
    ], 2, 2, 'Test')).toThrow('duplicate');
    expect(() => validateEmbeddingData([{ index: 0, embedding: [1, Number.NaN] }], 1, 2, 'Test')).toThrow('non-finite');
    expect(() => validateEmbeddingData([{ index: 0, embedding: [1] }], 1, 2, 'Test')).toThrow('dimensions mismatch');
  });
});
