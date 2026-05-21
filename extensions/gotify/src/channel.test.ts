import { describe, expect, it, vi, beforeEach } from 'vitest';

import { dispatchInboundMessage } from './channel.js';
import { resolveGotifyAccount } from './config.js';
import { setOwnApplicationId } from './runtime.js';
import type { GotifyStreamEnvelope } from './types.js';

vi.mock('./gotify-api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./gotify-api.js')>();
  return {
    ...actual,
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    sendGotifyMessageWithDeliveryRetry: vi.fn().mockResolvedValue({ id: 999, appid: 1 }),
    resolveApplicationName: vi.fn().mockResolvedValue(undefined),
  };
});

import { deleteMessage, resolveApplicationName, sendGotifyMessageWithDeliveryRetry } from './gotify-api.js';

function makeAccount() {
  return resolveGotifyAccount(
    {
      channels: {
        gotify: {
          serverUrl: 'https://push.example.com',
          appToken: 'app-token',
          clientToken: 'client-token',
          inbound: { enabled: true },
          allowFrom: ['*'],
        },
      },
    },
    'default'
  );
}

function makeCtx(
  overrides: {
    dispatchReplyWithBufferedBlockDispatcher?: ReturnType<typeof vi.fn>;
    resolveAgentRoute?: ReturnType<typeof vi.fn>;
  } = {}
) {
  const dispatchReplyWithBufferedBlockDispatcher =
    overrides.dispatchReplyWithBufferedBlockDispatcher ?? vi.fn().mockResolvedValue(undefined);
  const resolveAgentRoute =
    overrides.resolveAgentRoute ??
    vi.fn().mockResolvedValue({
      agentId: 'main',
      sessionKey: 'agent:main:direct:42',
      mainSessionKey: 'agent:main:main',
    });

  const recordInboundSession = vi.fn().mockResolvedValue(undefined);

  const runAssembled = vi.fn(async (params: {
    recordInboundSession: typeof recordInboundSession;
    dispatchReplyWithBufferedBlockDispatcher: typeof dispatchReplyWithBufferedBlockDispatcher;
    storePath: string;
    routeSessionKey: string;
    ctxPayload: unknown;
    cfg: unknown;
    record?: { updateLastRoute?: unknown; onRecordError?: (err: unknown) => void };
    delivery: { deliver: (payload: { text: string }) => Promise<void> };
  }) => {
    await params.recordInboundSession({
      storePath: params.storePath,
      sessionKey: params.routeSessionKey,
      ctx: params.ctxPayload,
      updateLastRoute: params.record?.updateLastRoute,
      onRecordError: params.record?.onRecordError,
    });
    await params.dispatchReplyWithBufferedBlockDispatcher({
      ctx: params.ctxPayload,
      cfg: params.cfg,
      dispatcherOptions: { deliver: params.delivery.deliver },
    });
  });

  return {
    cfg: {},
    accountId: 'default',
    account: makeAccount(),
    runtime: {},
    abortSignal: new AbortController().signal,
    setStatus: vi.fn(),
    channelRuntime: {
      reply: {
        finalizeInboundContext: vi.fn().mockImplementation((params) => params),
        dispatchReplyWithBufferedBlockDispatcher,
      },
      routing: {
        resolveAgentRoute,
      },
      session: {
        resolveStorePath: vi.fn().mockReturnValue('/tmp/openclaw-sessions.json'),
        recordInboundSession,
      },
      turn: { runAssembled },
    },
  };
}

describe('dispatchInboundMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips outbound-marked stream messages to prevent feedback loop', async () => {
    const ctx = makeCtx();
    const dispatch = ctx.channelRuntime.reply
      .dispatchReplyWithBufferedBlockDispatcher as ReturnType<typeof vi.fn>;

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
    const dispatch = ctx.channelRuntime.reply
      .dispatchReplyWithBufferedBlockDispatcher as ReturnType<typeof vi.fn>;

    await dispatchInboundMessage(ctx as never, account, {
      id: 2,
      appid: 99,
      message: 'self echo',
    });

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('uses resolveGotifyPeerId for routing peer id', async () => {
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

  it('does not dedupe different message ids from the same peer (multi-turn)', async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ dispatchReplyWithBufferedBlockDispatcher: dispatch });
    const account = makeAccount();

    await dispatchInboundMessage(ctx as never, account, {
      id: 101,
      appid: 5,
      message: 'turn one',
    });
    await dispatchInboundMessage(ctx as never, account, {
      id: 102,
      appid: 5,
      message: 'turn two',
    });

    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('does not mark dedup when dispatch fails so the message can be retried', async () => {
    const dispatch = vi
      .fn()
      .mockRejectedValueOnce(new Error('agent unavailable'))
      .mockResolvedValueOnce(undefined);
    const ctx = makeCtx({ dispatchReplyWithBufferedBlockDispatcher: dispatch });
    const account = makeAccount();
    const message: GotifyStreamEnvelope = { id: 103, appid: 5, message: 'retry me' };

    await expect(dispatchInboundMessage(ctx as never, account, message)).rejects.toThrow(
      'agent unavailable'
    );
    await dispatchInboundMessage(ctx as never, account, message);

    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('deletes inbound only after outbound deliver completes', async () => {
    vi.mocked(deleteMessage).mockClear();
    const order: string[] = [];
    vi.mocked(deleteMessage).mockImplementation(async (_account, id) => {
      order.push(`delete:${id}`);
    });
    const dispatch = vi.fn().mockImplementation(async ({ dispatcherOptions }) => {
      order.push('dispatch:start');
      await dispatcherOptions.deliver({ text: 'agent reply' });
      order.push('dispatch:end');
    });
    const ctx = makeCtx({ dispatchReplyWithBufferedBlockDispatcher: dispatch });
    const account = makeAccount();

    await dispatchInboundMessage(ctx as never, account, {
      id: 401,
      appid: 5,
      message: 'question',
    });

    expect(order).toEqual(['dispatch:start', 'delete:999', 'dispatch:end', 'delete:401']);
  });

  it('uses delivery retry helper for outbound send', async () => {
    const dispatch = vi.fn().mockImplementation(async ({ dispatcherOptions }) => {
      await dispatcherOptions.deliver({ text: 'agent reply' });
    });
    const ctx = makeCtx({ dispatchReplyWithBufferedBlockDispatcher: dispatch });

    await dispatchInboundMessage(ctx as never, makeAccount(), {
      id: 402,
      appid: 5,
      message: 'ping',
    });

    expect(sendGotifyMessageWithDeliveryRetry).toHaveBeenCalled();
  });

  it('maps inbound text to Body fields for agent prompt', async () => {
    const finalizeInboundContext = vi.fn().mockImplementation((params) => params);
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ dispatchReplyWithBufferedBlockDispatcher: dispatch });
    (ctx.channelRuntime.reply.finalizeInboundContext as ReturnType<typeof vi.fn>) =
      finalizeInboundContext;

    await dispatchInboundMessage(ctx as never, makeAccount(), {
      id: 200,
      appid: 10,
      message: '你好 Gotify',
    });

    expect(finalizeInboundContext).toHaveBeenCalledWith(
      expect.objectContaining({
        Body: '你好 Gotify',
        RawBody: '你好 Gotify',
        CommandBody: '你好 Gotify',
        SessionKey: 'agent:main:direct:42',
        Provider: 'gotify',
        ConversationLabel: 'gotify:10:default:direct:10',
        SenderName: 'app 10',
        To: 'gotify:10',
        OriginatingTo: 'gotify:10',
        NativeDirectUserId: '10',
      })
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('uses message title for ConversationLabel when API name is unavailable', async () => {
    const finalizeInboundContext = vi.fn().mockImplementation((params) => params);
    const ctx = makeCtx();
    (ctx.channelRuntime.reply.finalizeInboundContext as ReturnType<typeof vi.fn>) =
      finalizeInboundContext;

    await dispatchInboundMessage(ctx as never, makeAccount(), {
      id: 201,
      appid: 4,
      title: 'e2e-user',
      message: 'hello',
    });

    expect(finalizeInboundContext).toHaveBeenCalledWith(
      expect.objectContaining({
        ConversationLabel: 'gotify:e2e-user:default:direct:4',
        SenderName: 'e2e-user',
        SenderId: '4',
        To: 'gotify:4',
        OriginatingTo: 'gotify:4',
        NativeDirectUserId: '4',
      })
    );
  });

  it('resolves ConversationLabel and SenderName from Gotify application API', async () => {
    const finalizeInboundContext = vi.fn().mockImplementation((params) => params);
    const ctx = makeCtx();
    (ctx.channelRuntime.reply.finalizeInboundContext as ReturnType<typeof vi.fn>) =
      finalizeInboundContext;
    (resolveApplicationName as ReturnType<typeof vi.fn>).mockResolvedValueOnce('Alert Manager');

    await dispatchInboundMessage(ctx as never, makeAccount(), {
      id: 204,
      appid: 10,
      title: 'ignored-title',
      message: 'hello',
    });

    expect(resolveApplicationName).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'default' }), 10);
    expect(finalizeInboundContext).toHaveBeenCalledWith(
      expect.objectContaining({
        ConversationLabel: 'gotify:Alert Manager:default:direct:10',
        SenderName: 'Alert Manager',
      })
    );
  });

  it('records inbound session with peer-scoped last route via turn.runAssembled', async () => {
    const resolveAgentRoute = vi.fn().mockResolvedValue({
      agentId: 'main',
      sessionKey: 'agent:main:gotify:default:direct:4',
      mainSessionKey: 'agent:main:main',
      lastRoutePolicy: 'main',
    });
    const ctx = makeCtx({ resolveAgentRoute });
    const recordInboundSession = ctx.channelRuntime.session!.recordInboundSession as ReturnType<
      typeof vi.fn
    >;
    const runAssembled = ctx.channelRuntime.turn!.runAssembled as ReturnType<typeof vi.fn>;

    await dispatchInboundMessage(ctx as never, makeAccount(), {
      id: 203,
      appid: 4,
      message: 'hello',
    });

    expect(runAssembled).toHaveBeenCalledTimes(1);
    expect(recordInboundSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: 'agent:main:gotify:default:direct:4',
        updateLastRoute: {
          sessionKey: 'agent:main:main',
          channel: 'gotify',
          to: 'gotify:4',
          accountId: 'default',
        },
      })
    );
  });

  it('uses extras.openclaw.peerId for ConversationLabel when human-readable', async () => {
    const finalizeInboundContext = vi.fn().mockImplementation((params) => params);
    const ctx = makeCtx();
    (ctx.channelRuntime.reply.finalizeInboundContext as ReturnType<typeof vi.fn>) =
      finalizeInboundContext;

    await dispatchInboundMessage(ctx as never, makeAccount(), {
      id: 202,
      appid: 4,
      message: 'hello',
      extras: { openclaw: { peerId: 'ops-bot' } },
    });

    expect(finalizeInboundContext).toHaveBeenCalledWith(
      expect.objectContaining({
        ConversationLabel: 'gotify:ops-bot:default:direct:ops-bot',
        SenderName: 'ops-bot',
        SenderId: 'ops-bot',
      })
    );
  });

  it('deletes message from Gotify after successful dispatch', async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ dispatchReplyWithBufferedBlockDispatcher: dispatch });
    const account = makeAccount();

    await dispatchInboundMessage(ctx as never, account, {
      id: 300,
      appid: 5,
      message: 'consume me',
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(deleteMessage).toHaveBeenCalledWith(account, 300);
  });

  it('skips delete when inbound.deleteAfterConsume is false', async () => {
    vi.mocked(deleteMessage).mockClear();
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ dispatchReplyWithBufferedBlockDispatcher: dispatch });
    const account = resolveGotifyAccount(
      {
        channels: {
          gotify: {
            serverUrl: 'https://push.example.com',
            appToken: 'app-token',
            clientToken: 'client-token',
            inbound: { enabled: true, deleteAfterConsume: false },
            allowFrom: ['*'],
          },
        },
      },
      'default'
    );

    await dispatchInboundMessage(ctx as never, account, {
      id: 302,
      appid: 5,
      message: 'keep on server',
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(deleteMessage).not.toHaveBeenCalled();
  });

  it('deletes outbound reply from Gotify after successful send', async () => {
    vi.mocked(deleteMessage).mockClear();
    const dispatch = vi.fn().mockImplementation(async ({ dispatcherOptions }) => {
      await dispatcherOptions.deliver({ text: 'agent reply' });
    });
    const ctx = makeCtx({ dispatchReplyWithBufferedBlockDispatcher: dispatch });
    const account = makeAccount();

    await dispatchInboundMessage(ctx as never, account, {
      id: 400,
      appid: 5,
      message: 'question',
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(deleteMessage).toHaveBeenCalledWith(account, 400);
    expect(deleteMessage).toHaveBeenCalledWith(account, 999);
  });

  it('does not delete message when dispatch is skipped', async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ dispatchReplyWithBufferedBlockDispatcher: dispatch });

    await dispatchInboundMessage(ctx as never, makeAccount(), {
      id: 301,
      appid: 5,
      message: '   ',
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(deleteMessage).not.toHaveBeenCalled();
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
