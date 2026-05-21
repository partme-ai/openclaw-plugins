import { describe, expect, it, vi } from 'vitest';

import { resolveGotifyAccount } from './config.js';
import { GotifyWebSocketError } from './errors.js';
import { createGotifyWsListener } from './ws-listener.js';

class FakeWebSocket {
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: string }) => void) | null = null;
  public onerror: ((event: { message?: string }) => void) | null = null;
  public onclose: ((event?: { wasClean?: boolean; reason?: string }) => void) | null = null;
  public static instances: FakeWebSocket[] = [];
  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  close(): void {
    this.onclose?.({ wasClean: true, reason: 'stopped' });
  }
}

function makeAccount(overrides: { maxReconnectAttempts?: number } = {}) {
  return resolveGotifyAccount(
    {
      channels: {
        gotify: {
          serverUrl: 'https://push.example.com',
          appToken: 'app-token',
          clientToken: 'client-token',
          inbound: {
            enabled: true,
            reconnectDelayMs: 10,
            maxReconnectDelayMs: 20,
            maxReconnectAttempts: overrides.maxReconnectAttempts ?? 10,
          },
        },
      },
    },
    'default'
  );
}

describe('ws-listener', () => {
  it('connects and forwards parsed messages', async () => {
    FakeWebSocket.instances = [];
    const account = makeAccount();
    const onMessage = vi.fn();

    const listener = createGotifyWsListener(account, {
      WebSocketImpl: FakeWebSocket as never,
      onMessage,
    });

    const startPromise = listener.start();
    const instance = FakeWebSocket.instances[0];
    instance.onopen?.();
    await startPromise;
    await instance.onmessage?.({ data: JSON.stringify({ id: 1, message: 'hello' }) });

    expect(instance.url).toContain('/stream?token=client-token');
    expect(onMessage).toHaveBeenCalledWith({ id: 1, message: 'hello' });
    listener.stop();
  });

  it('rejects start() when connection closes before open', async () => {
    FakeWebSocket.instances = [];
    const account = makeAccount();
    const listener = createGotifyWsListener(account, {
      WebSocketImpl: FakeWebSocket as never,
      onMessage: vi.fn(),
      connectionTimeoutMs: 5_000,
    });

    const startPromise = listener.start();
    const instance = FakeWebSocket.instances[0];
    instance.onclose?.({ wasClean: false, reason: 'connection refused' });

    await expect(startPromise).rejects.toBeInstanceOf(GotifyWebSocketError);
    listener.stop();
  });

  it('does not throw uncaught when reconnect attempts are exhausted', async () => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    const account = makeAccount({ maxReconnectAttempts: 0 });
    const onStateChange = vi.fn();

    const listener = createGotifyWsListener(account, {
      WebSocketImpl: FakeWebSocket as never,
      onMessage: vi.fn(),
      onStateChange,
      connectionTimeoutMs: 5_000,
    });

    const startPromise = listener.start();
    const first = FakeWebSocket.instances[0];
    first.onopen?.();
    await startPromise;

    first.onclose?.({ wasClean: false, reason: 'dropped' });

    await expect(vi.runAllTimersAsync()).resolves.not.toThrow();

    expect(onStateChange).toHaveBeenCalledWith(
      expect.objectContaining({
        running: false,
        lastError: expect.stringContaining('reconnect attempts exhausted'),
      })
    );

    listener.stop();
    vi.useRealTimers();
  });
});
