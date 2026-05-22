import { describe, expect, it } from 'vitest';

import { mapGotifyToInbound, mapOutboundToGotify } from '../src/routing/message-mapper.js';

describe('message-mapper', () => {
  it('maps outbound metadata to gotify extras', () => {
    const payload = mapOutboundToGotify({
      text: 'hello',
      title: 'test',
      priority: 7,
      extras: {
        openclaw: { traceId: 'trace-1' },
      },
      metadata: {
        url: 'https://example.com/ticket/1',
        contentType: 'text/markdown',
      },
    } as never);

    expect(payload.message).toBe('hello');
    expect(payload.title).toBe('test');
    expect(payload.priority).toBe(7);
    expect(payload.extras).toMatchObject({
      openclaw: { traceId: 'trace-1', source: 'openclaw', outbound: true },
      'client::notification': {
        click: {
          url: 'https://example.com/ticket/1',
        },
      },
      'client::display': {
        contentType: 'text/markdown',
      },
    });
  });

  it('maps stream envelope to inbound text and metadata', () => {
    const inbound = mapGotifyToInbound({
      id: 11,
      appid: 22,
      message: 'from gotify',
      title: 'alarm',
      priority: 9,
      extras: {
        openclaw: { peerId: 'peer-1' },
      },
      date: '2026-04-23T00:00:00Z',
    });

    expect(inbound.text).toBe('from gotify');
    expect(inbound.metadata).toMatchObject({
      id: 11,
      appid: 22,
      title: 'alarm',
      priority: 9,
      date: '2026-04-23T00:00:00Z',
    });
  });
});
