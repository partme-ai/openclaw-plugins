import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestProviderJson } from './provider-http.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('requestProviderJson', () => {
  it('仅对 429 与 5xx 做有限退避重试', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":"busy"}', { status: 429 }))
      .mockResolvedValueOnce(new Response('{"error":"down"}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const resultPromise = requestProviderJson<{ ok: boolean }>(
      'https://provider.example/v1/test',
      { method: 'POST' },
      { maxRetries: 2 },
      'Fixture',
      'Probe',
    );
    await vi.runAllTimersAsync();

    await expect(resultPromise).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('400 配置错误不重试，并清理错误正文中的凭据与控制字符', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      'api_key=secret-value\nAuthorization: Bearer leaked-token\u0000',
      { status: 400, statusText: 'Bad Request' },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestProviderJson(
      'https://provider.example/v1/test',
      { method: 'POST' },
      { maxRetries: 2 },
      'Fixture',
      'Probe',
    )).rejects.toThrow('api_key=[REDACTED]');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(requestProviderJson(
      'https://provider.example/v1/test',
      { method: 'POST' },
      { maxRetries: 0 },
      'Fixture',
      'Probe',
    )).rejects.not.toThrow(/secret-value|leaked-token|\u0000/u);
  });

  it('在读取流期间执行响应字节上限，而不信任缺失的 content-length', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"payload":"'));
        controller.enqueue(new TextEncoder().encode('far-too-large"}'));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));

    await expect(requestProviderJson(
      'https://provider.example/v1/test',
      { method: 'GET' },
      { maxRetries: 0, maxResponseBytes: 12 },
      'Fixture',
      'Probe',
    )).rejects.toThrow('response exceeds 12 bytes');
  });

  it('调用方取消时立即停止，且不会误报为 Provider 超时或发起重试', async () => {
    const abort = new AbortController();
    abort.abort();
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestProviderJson(
      'https://provider.example/v1/test',
      { method: 'POST', signal: abort.signal },
      { maxRetries: 2 },
      'Fixture',
      'Probe',
    )).rejects.toThrow('request aborted by caller');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
