import { describe, expect, it } from 'vitest';

import { checkGotifyInboundAccess } from './inbound-access.js';
import { resolveGotifyAccount } from './config.js';

function accountWithPolicy(
  dmPolicy: 'open' | 'allowlist' | 'pairing' | 'disabled',
  allowFrom: Array<string | number> = []
) {
  return resolveGotifyAccount(
    {
      channels: {
        gotify: {
          serverUrl: 'https://push.example.com',
          appToken: 'app-token',
          dmPolicy,
          allowFrom,
        },
      },
    },
    'default'
  );
}

describe('checkGotifyInboundAccess (SDK ingress)', () => {
  it('allows any sender when dmPolicy is open and allowFrom includes wildcard', async () => {
    const result = await checkGotifyInboundAccess({
      cfg: {},
      account: accountWithPolicy('open', ['*']),
      peerId: 'unknown',
      appid: 99,
    });
    expect(result.allowed).toBe(true);
  });

  it('blocks open policy without wildcard allowFrom (SDK semantics)', async () => {
    const result = await checkGotifyInboundAccess({
      cfg: {},
      account: accountWithPolicy('open'),
      peerId: 'unknown',
      appid: 99,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('dm_policy_not_allowlisted');
  });

  it('blocks all inbound when dmPolicy is disabled', async () => {
    const result = await checkGotifyInboundAccess({
      cfg: {},
      account: accountWithPolicy('disabled'),
      peerId: 'allowed-peer',
      appid: 1,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('dm_policy_disabled');
  });

  it('matches allowlist by peerId or appid alias', async () => {
    const account = accountWithPolicy('allowlist', ['42', 'peer-a']);
    expect(
      (
        await checkGotifyInboundAccess({
          cfg: {},
          account,
          peerId: 'peer-a',
          appid: 999,
        })
      ).allowed
    ).toBe(true);
    expect(
      (
        await checkGotifyInboundAccess({
          cfg: {},
          account,
          peerId: 'other',
          appid: 42,
        })
      ).allowed
    ).toBe(true);
    expect(
      (
        await checkGotifyInboundAccess({
          cfg: {},
          account,
          peerId: 'other',
          appid: 7,
        })
      ).allowed
    ).toBe(false);
  });

  it('requires pairing when dmPolicy is pairing and sender not allowlisted', async () => {
    const result = await checkGotifyInboundAccess({
      cfg: {},
      account: accountWithPolicy('pairing'),
      peerId: 'new-sender',
      appid: 1,
    });
    expect(result.allowed).toBe(false);
    expect(result.decision).toBe('pairing');
    expect(result.reason).toBe('dm_policy_pairing_required');
  });
});
