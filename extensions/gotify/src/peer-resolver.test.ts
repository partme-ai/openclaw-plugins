import { describe, expect, it } from 'vitest';

import {
  resolveGotifyPeerId,
  resolveGotifyConversationLabel,
  resolveGotifySenderName,
} from './peer-resolver.js';

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

describe('resolveGotifyConversationLabel', () => {
  it('uses structured label with extras.openclaw.peerId', () => {
    expect(
      resolveGotifyConversationLabel(
        { appid: 4, extras: { openclaw: { peerId: 'ops-bot' } } },
        'ops-bot',
        { accountId: 'default' }
      )
    ).toBe('gotify:ops-bot:default:direct:ops-bot');
  });

  it('uses API application name in label', () => {
    expect(
      resolveGotifyConversationLabel(
        { appid: 4, title: 'e2e-user' },
        '4',
        { accountId: 'default', appName: 'Alert Bot' }
      )
    ).toBe('gotify:Alert Bot:default:direct:4');
  });

  it('uses message title when API name is unavailable', () => {
    expect(
      resolveGotifyConversationLabel({ appid: 4, title: 'e2e-user' }, '4', {
        accountId: 'default',
      })
    ).toBe('gotify:e2e-user:default:direct:4');
  });

  it('includes custom accountId in label', () => {
    expect(
      resolveGotifyConversationLabel({ appid: 4, title: 'e2e-user' }, '4', {
        accountId: 'prod',
      })
    ).toBe('gotify:e2e-user:prod:direct:4');
  });

  it('falls back to appid segment when only appid is available', () => {
    expect(
      resolveGotifyConversationLabel({ appid: 4 }, '4', { accountId: 'default' })
    ).toBe('gotify:4:default:direct:4');
  });

  it('accepts legacy appName-only third argument', () => {
    expect(resolveGotifyConversationLabel({ appid: 4, title: 'ignored' }, '4', 'Alert Bot')).toBe(
      'gotify:Alert Bot:default:direct:4'
    );
  });
});

describe('resolveGotifySenderName', () => {
  it('prefers API application name over message title', () => {
    expect(resolveGotifySenderName({ appid: 4, title: 'e2e-user' }, '4', 'Alert Bot')).toBe(
      'Alert Bot'
    );
  });

  it('prefers message title when API name is unavailable', () => {
    expect(resolveGotifySenderName({ appid: 4, title: 'e2e-user' }, '4')).toBe('e2e-user');
  });

  it('formats numeric appid as app label instead of bare id', () => {
    expect(resolveGotifySenderName({ appid: 4 }, '4')).toBe('app 4');
  });

  it('falls back to peerId for non-numeric tokens', () => {
    expect(resolveGotifySenderName({ title: 'alarm-bot' }, 'alarm-bot')).toBe('alarm-bot');
  });
});
