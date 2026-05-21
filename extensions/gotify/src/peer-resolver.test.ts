import { describe, expect, it } from 'vitest';

import { resolveGotifyPeerId } from './peer-resolver.js';

describe('resolveGotifyPeerId', () => {
  it('prefers extras.openclaw.peerId over appid', () => {
    expect(
      resolveGotifyPeerId({
        appid: 10,
        extras: { openclaw: { peerId: 'peer-99' } },
      })
    ).toBe('peer-99');
  });

  it('uses appid when no extras peerId', () => {
    expect(resolveGotifyPeerId({ appid: 42 })).toBe('42');
  });

  it('uses title when no appid', () => {
    expect(resolveGotifyPeerId({ title: 'alarm-bot' })).toBe('alarm-bot');
  });

  it('falls back to gotify', () => {
    expect(resolveGotifyPeerId({})).toBe('gotify');
  });

  it('normalizes tokens to lowercase and trimmed', () => {
    expect(resolveGotifyPeerId({ appid: '  APP_99  ' })).toBe('app_99');
    expect(resolveGotifyPeerId({ title: '  MyBot  ' })).toBe('mybot');
  });
});
