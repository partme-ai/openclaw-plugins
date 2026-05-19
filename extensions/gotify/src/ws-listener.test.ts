import { describe, expect, it, vi } from 'vitest';

import { resolveGotifyAccount } from './config.js';
import { createGotifyWsListener } from './ws-listener.js';

class FakeWebSocket {
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: string }) => void) | null = null;
  public onerror: ((event: { message?: string }) => void) | null = null;
  public onclose: (() => void) | null = null;
  public static instances: FakeWebSocket[] = [];
  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  close(): void {
    this.onclose?.();
  }
}

describe('ws-listener', () => {
  it('connects and forwards parsed messages', async () => {
    const account = resolveGotifyAccount(
      {
        channels: {
          gotify: {
            serverUrl: 'https://push.example.com',
            appToken: 'app-token',
            clientToken: 'client-token',
            inbound: { enabled: true },
          },
        },
      },
      'default'
    );
    const onMessage = vi.fn();

    const listener = createGotifyWsListener(account, {
      WebSocketImpl: FakeWebSocket as never,
      onMessage,
    });

    listener.start();
    const instance = FakeWebSocket.instances[0];
    instance.onopen?.();
    await instance.onmessage?.({ data: JSON.stringify({ id: 1, message: 'hello' }) });

    expect(instance.url).toContain('/stream?token=client-token');
    expect(onMessage).toHaveBeenCalledWith({ id: 1, message: 'hello' });
    listener.stop();
  });
});
