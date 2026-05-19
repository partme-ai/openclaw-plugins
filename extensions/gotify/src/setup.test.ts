import { describe, expect, it, vi } from 'vitest';

import { resolveGotifyAccount } from './config.js';
import { bootstrapGotifyAccount } from './setup.js';

describe('setup', () => {
  it('creates application when missing and auto-create enabled', async () => {
    const account = resolveGotifyAccount(
      {
        channels: {
          gotify: {
            serverUrl: 'https://push.example.com',
            appToken: 'app-token',
            clientToken: 'client-token',
            bootstrap: {
              enabled: true,
              autoCreateApplication: true,
              applicationName: 'openclaw-default',
            },
          },
        },
      },
      'default'
    );

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 7, name: 'openclaw-default', token: 'generated-token' }),
      });

    const originalFetch = global.fetch;
    global.fetch = fetchImpl as unknown as typeof fetch;
    try {
      const result = await bootstrapGotifyAccount(account);
      expect(result.created).toBe(true);
      expect(result.applicationToken).toBe('generated-token');
    } finally {
      global.fetch = originalFetch;
    }
  });
});
