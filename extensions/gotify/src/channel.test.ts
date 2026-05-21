import { describe, expect, it, vi, beforeEach } from 'vitest';

import { dispatchInboundMessage } from './channel.js';
import { resolveGotifyAccount } from './config.js';
import { setOwnApplicationId } from './runtime.js';
import type { GotifyStreamEnvelope } from './types.js';

function makeAccount() {
  return resolveGotifyAccount(
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
}

function makeCtx(overrides: {
  dispatchReplyWithBufferedBlockDispatcher?: ReturnType<typeof vi.fn>;
  resolveAgentRoute?: ReturnType<typeof vi.fn>;
} = {}) {
  const dispatchReplyWithBufferedBlockDispatcher =
    overrides.dispatchReplyWithBufferedBlockDispatcher ?? vi.fn().mockResolvedValue(undefined);
  const resolveAgentRoute =
    overrides.resolveAgentRoute ??
    vi.fn().mockResolvedValue({ agentId: 'main', sessionKey: 'agent:main:direct:42' });

  return {
    cfg: {},
    accountId: 'default',
    account: makeAccount(),
    runtime: {},
    abortSignal: new AbortController().signal,
    setStatus: vi.fn(),
    channelRuntime: {
      reply: {
        finalizeInboundContext: vi.fn().mockResolvedValue({ text: 'ctx' }),
        dispatchReplyWithBufferedBlockDispatcher,
      },
      routing: {
        resolveAgentRoute,
      },
    },
  };
}

describe('dispatchInboundMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips outbound-marked stream messages to prevent feedback loop', async () => {
    const ctx = makeCtx();
    const dispatch = ctx.channelRuntime!.reply.dispatchReplyWithBufferedBlockDispatcher as ReturnType<
      typeof vi.fn
    >;

    await dispatchInboundMessage(ctx as never, makeAccount(), {
      id: 1,
      message: 'echo',
      extras: {
        openclaw: { source: 'openclaw', outbound: true },
      },
    });

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('skips messages from own cached application id', async () => {
    const account = makeAccount();
    setOwnApplicationId(account.accountId, 99);
    const ctx = makeCtx();
    const dispatch = ctx.channelRuntime!.reply.dispatchReplyWithBufferedBlockDispatcher as ReturnType<
      typeof vi.fn
    >;

    await dispatchInboundMessage(ctx as never, account, {
      id: 2,
      appid: 99,
      message: 'self echo',
    });

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('uses resolvePeerIdFromStreamMessage for routing peer id', async () => {
    const resolveAgentRoute = vi.fn().mockResolvedValue({ agentId: 'main', sessionKey: 'sk' });
    const ctx = makeCtx({ resolveAgentRoute });

    const message: GotifyStreamEnvelope = {
      id: 3,
      appid: 10,
      message: 'hello',
      extras: { openclaw: { peerId: 'CustomPeer' } },
    };

    await dispatchInboundMessage(ctx as never, makeAccount(), message);

    expect(resolveAgentRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        peer: { kind: 'direct', id: 'custompeer' },
      })
    );
  });

  it('deduplicates by accountId:messageId within the window', async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ dispatchReplyWithBufferedBlockDispatcher: dispatch });
    const account = makeAccount();
    const message: GotifyStreamEnvelope = { id: 100, appid: 5, message: 'once' };

    await dispatchInboundMessage(ctx as never, account, message);
    await dispatchInboundMessage(ctx as never, account, message);

    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('skips dispatch when inbound text is empty', async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ dispatchReplyWithBufferedBlockDispatcher: dispatch });

    await dispatchInboundMessage(ctx as never, makeAccount(), {
      id: 4,
      appid: 10,
      message: '   ',
    });

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('blocks inbound when dmPolicy is disabled', async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ dispatchReplyWithBufferedBlockDispatcher: dispatch });
    const account = resolveGotifyAccount(
      {
        channels: {
          gotify: {
            serverUrl: 'https://push.example.com',
            appToken: 'app-token',
            clientToken: 'client-token',
            inbound: { enabled: true },
            dmPolicy: 'disabled',
          },
        },
      },
      'default'
    );

    await dispatchInboundMessage(ctx as never, account, {
      id: 5,
      appid: 10,
      message: 'hello',
    });

    expect(dispatch).not.toHaveBeenCalled();
  });
});
