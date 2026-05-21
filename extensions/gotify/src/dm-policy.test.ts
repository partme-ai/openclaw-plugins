import { describe, expect, it } from 'vitest';

import { resolveGotifyAccount } from './config.js';
import {
  checkGotifyInboundDmAccess,
  isGotifySenderAllowed,
  normalizeGotifyAllowFromEntry,
} from './dm-policy.js';

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

describe('dm-policy', () => {
  it('normalizes gotify: prefix on allowFrom entries', () => {
    expect(normalizeGotifyAllowFromEntry('GOTIFY:App42')).toBe('app42');
  });

  it('allows any sender when dmPolicy is open', () => {
    const result = checkGotifyInboundDmAccess({
      account: accountWithPolicy('open'),
      peerId: 'unknown',
      appid: 99,
    });
    expect(result.allowed).toBe(true);
  });

  it('blocks all inbound when dmPolicy is disabled', () => {
    const result = checkGotifyInboundDmAccess({
      account: accountWithPolicy('disabled'),
      peerId: 'allowed-peer',
      appid: 1,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('disabled');
  });

  it('matches allowlist by peerId or appid', () => {
    const account = accountWithPolicy('allowlist', ['42', 'peer-a']);
    expect(
      checkGotifyInboundDmAccess({ account, peerId: 'peer-a', appid: 999 }).allowed
    ).toBe(true);
    expect(checkGotifyInboundDmAccess({ account, peerId: 'other', appid: 42 }).allowed).toBe(
      true
    );
    expect(checkGotifyInboundDmAccess({ account, peerId: 'other', appid: 7 }).allowed).toBe(
      false
    );
  });

  it('supports wildcard in allowFrom', () => {
    expect(isGotifySenderAllowed('anyone', ['*'])).toBe(true);
  });
});
