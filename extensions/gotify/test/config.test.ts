import { describe, expect, it } from 'vitest';

import {
  listGotifyAccountIds,
  resolveDefaultGotifyAccountId,
  resolveGotifyAccount,
} from '../src/config.js';

describe('config', () => {
  it('resolves single-account top-level config', () => {
    const account = resolveGotifyAccount(
      {
        channels: {
          gotify: {
            serverUrl: 'https://push.example.com',
            appToken: 'app-token',
          },
        },
      },
      'default'
    );

    expect(account.configured).toBe(true);
    expect(account.accountId).toBe('default');
    expect(account.serverUrl).toBe('https://push.example.com');
    expect(account.inbound.enabled).toBe(false);
  });

  it('prefers explicit default account from accounts map', () => {
    const cfg = {
      channels: {
        gotify: {
          defaultAccount: 'ops',
          accounts: {
            ops: { serverUrl: 'https://ops.example.com', appToken: 'ops-token' },
            alert: { serverUrl: 'https://alert.example.com', appToken: 'alert-token' },
          },
        },
      },
    };

    expect(resolveDefaultGotifyAccountId(cfg)).toBe('ops');
    expect(listGotifyAccountIds(cfg)).toEqual(['ops', 'alert']);
    expect(resolveGotifyAccount(cfg, null).serverUrl).toBe('https://ops.example.com');
  });
});
