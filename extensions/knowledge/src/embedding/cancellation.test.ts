import { afterEach, describe, it, expect, vi } from 'vitest';
import { createEmbeddingService } from './factory.js';

afterEach(() => vi.unstubAllGlobals());
describe('embedding cancellation reaches HTTP for every provider', () => {
  it.each(['openai', 'dashscope', 'zhipu', 'qianfan', 'ollama'])('%s cancels active fetch and does not retry', async provider => {
    const controller = new AbortController();
    let ioSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_input: unknown, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      ioSignal = init.signal as AbortSignal;
      ioSignal.addEventListener('abort', () => reject(ioSignal!.reason), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const service = createEmbeddingService({ provider, apiKey: 'fixture', dimensions: 3, baseUrl: 'http://127.0.0.1:1', maxRetries: 2 });
    const pending = service.embed('test', controller.signal);
    const assertion = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(ioSignal).toBeDefined());
    controller.abort();
    await assertion;
    expect(ioSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
