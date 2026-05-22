import { describe, expect, it, vi } from 'vitest';

import {
  buildMessageRequest,
  sendGotifyMessage,
  getMessages,
  deleteAllMessages,
  deleteMessage,
  getApplicationMessages,
  deleteApplicationMessages,
  listApplications,
  resolveApplicationName,
  clearApplicationNameCache,
  createApplication,
  updateApplication,
  deleteApplication,
  listClients,
  createClient,
  updateClient,
  deleteClient,
  healthCheck,
  runGotifyDoctor,
} from '../src/transport/gotify-api.js';
import {
  listGotifyAccountIds,
  resolveDefaultGotifyAccountId,
  resolveGotifyAccount,
} from '../src/config.js';
import { mapGotifyToInbound, mapOutboundToGotify } from '../src/routing/message-mapper.js';
import { selectAccountId } from '../src/outbound.js';

// ── Test fixtures ──────────────────────────────────────────────────────────────

function createTestAccount(overrides: Record<string, unknown> = {}) {
  return resolveGotifyAccount(
    {
      channels: {
        gotify: {
          serverUrl: 'https://push.example.com/',
          appToken: 'app-token',
          clientToken: 'client-token',
          ...overrides,
        },
      },
    },
    'default'
  );
}

function createMultiAccountCfg() {
  return {
    channels: {
      gotify: {
        defaultAccount: 'ops',
        accounts: {
          ops: {
            serverUrl: 'https://ops.example.com',
            appToken: 'ops-token',
            clientToken: 'ops-client',
          },
          alert: {
            serverUrl: 'https://alert.example.com',
            appToken: 'alert-token',
            clientToken: 'alert-client',
            defaultPriority: 9,
          },
        },
      },
    },
  };
}

function mockFetch(
  responses: Array<{ ok: boolean; status?: number; json: () => Promise<unknown> }>
) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: r.json,
      text: async () => JSON.stringify(await r.json()),
    } as Response);
  }
  return fn;
}

// ── Message API Tests ──────────────────────────────────────────────────────────

describe('Message API', () => {
  const account = createTestAccount();

  it('builds message request with normalized URL', () => {
    const req = buildMessageRequest(account, { message: 'hello' });
    expect(req.url).toBe('https://push.example.com/message');
    expect(req.init.method).toBe('POST');
    expect(req.init.headers).toMatchObject({ 'X-Gotify-Key': 'app-token' });
  });

  it('builds message request with title and priority', () => {
    const req = buildMessageRequest(account, { message: 'test', title: 'Alert', priority: 8 });
    const body = JSON.parse(req.init.body as string);
    expect(body.message).toBe('test');
    expect(body.title).toBe('Alert');
    expect(body.priority).toBe(8);
  });

  it('builds message request with extras', () => {
    const extras = { 'client::notification': { click: { url: 'https://example.com' } } };
    const req = buildMessageRequest(account, { message: 'test', extras });
    const body = JSON.parse(req.init.body as string);
    expect(body.extras).toEqual(extras);
  });

  it('sends message and returns response', async () => {
    const fetchImpl = mockFetch([{ ok: true, json: async () => ({ id: 123, message: 'hello' }) }]);
    const result = await sendGotifyMessage(account, { message: 'hello' }, { fetchImpl });
    expect(result.id).toBe(123);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('retries on fetch failure', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 456 }) });
    const result = await sendGotifyMessage(
      account,
      { message: 'hello' },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        retryCount: 1,
        retryDelayMs: 0,
        timeoutMs: 0,
      }
    );
    expect(result.id).toBe(456);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('serializes requests per account', async () => {
    const order: string[] = [];
    const fetchImpl = vi.fn().mockImplementation(() => {
      order.push('req');
      return Promise.resolve({ ok: true, json: async () => ({ id: 1 }) });
    }) as unknown as typeof fetch;

    await Promise.all([
      sendGotifyMessage(account, { message: 'a' }, { fetchImpl }),
      sendGotifyMessage(account, { message: 'b' }, { fetchImpl }),
      sendGotifyMessage(account, { message: 'c' }, { fetchImpl }),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('retries on 5xx errors', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'Service Unavailable' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 999 }) });
    const result = await sendGotifyMessage(
      account,
      { message: 'test' },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        retryCount: 1,
        retryDelayMs: 0,
      }
    );
    expect(result.id).toBe(999);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry on 4xx errors', async () => {
    const badResponse = {
      ok: false,
      status: 400,
      text: async () => 'Bad Request',
      json: async () => ({}),
    } as Response;
    const fetchImpl = vi.fn().mockResolvedValue(badResponse);
    await expect(
      sendGotifyMessage(
        account,
        { message: 'test' },
        {
          fetchImpl: fetchImpl as unknown as typeof fetch,
          retryCount: 0,
        }
      )
    ).rejects.toThrow('Gotify API failed (400)');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('throws when missing appToken', () => {
    const noToken = createTestAccount({ appToken: undefined });
    expect(() => buildMessageRequest(noToken, { message: 'x' })).toThrow('not configured');
  });

  it('getMessages with default pagination', async () => {
    const fetchImpl = mockFetch([
      {
        ok: true,
        json: async () => ({
          messages: [{ id: 1, message: 'm1' }],
          paging: { size: 1, limit: 100, next: null, since: 0 },
        }),
      },
    ]);
    const result = await getMessages(account, undefined, { fetchImpl });
    expect(result.messages).toHaveLength(1);
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain(
      '/message?limit=100'
    );
  });

  it('getMessages with custom pagination', async () => {
    const fetchImpl = mockFetch([
      {
        ok: true,
        json: async () => ({ messages: [], paging: { size: 0, limit: 50, next: null, since: 10 } }),
      },
    ]);
    await getMessages(account, { limit: 50, since: 10 }, { fetchImpl });
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toContain('limit=50');
    expect(url).toContain('since=10');
  });

  it('getMessages clamps limit to 200 max', async () => {
    const fetchImpl = mockFetch([
      {
        ok: true,
        json: async () => ({ messages: [], paging: { size: 0, limit: 200, next: null, since: 0 } }),
      },
    ]);
    await getMessages(account, { limit: 999 }, { fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toContain('limit=200');
  });

  it('deleteMessage by id', async () => {
    const fetchImpl = mockFetch([{ ok: true, json: async () => ({}) }]);
    await deleteMessage(account, 42, { fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toContain('/message/42');
    expect((fetchImpl.mock.calls[0][1] as RequestInit).method).toBe('DELETE');
  });

  it('deleteAllMessages', async () => {
    const fetchImpl = mockFetch([{ ok: true, json: async () => ({}) }]);
    await deleteAllMessages(account, { fetchImpl });
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toContain('/message');
    expect((fetchImpl.mock.calls[0][1] as RequestInit).method).toBe('DELETE');
  });

  it('getApplicationMessages by app id', async () => {
    const fetchImpl = mockFetch([
      {
        ok: true,
        json: async () => ({
          messages: [{ id: 5, message: 'app-msg' }],
          paging: { size: 1, limit: 100, next: null, since: 0 },
        }),
      },
    ]);
    const result = await getApplicationMessages(account, 7, undefined, { fetchImpl });
    expect(result.messages[0].message).toBe('app-msg');
    expect(fetchImpl.mock.calls[0][0]).toContain('/application/7/message');
  });

  it('deleteApplicationMessages', async () => {
    const fetchImpl = mockFetch([{ ok: true, json: async () => ({}) }]);
    await deleteApplicationMessages(account, 7, { fetchImpl });
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toContain('/application/7/message');
    expect((fetchImpl.mock.calls[0][1] as RequestInit).method).toBe('DELETE');
  });
});

// ── Application API Tests ──────────────────────────────────────────────────────

describe('Application API', () => {
  const account = createTestAccount();

  it('listApplications', async () => {
    const fetchImpl = mockFetch([
      {
        ok: true,
        json: async () => [
          { id: 1, name: 'App1', token: 'A...', description: 'desc', internal: false },
        ],
      },
    ]);
    const apps = await listApplications(account, { fetchImpl });
    expect(apps).toHaveLength(1);
    expect(apps[0].name).toBe('App1');
    expect(fetchImpl.mock.calls[0][0]).toContain('/application');
  });

  it('resolveApplicationName loads and caches application names by appId', async () => {
    clearApplicationNameCache();
    const fetchImpl = mockFetch([
      {
        ok: true,
        json: async () => [
          { id: 10, name: 'Alert Manager', token: 'A...', internal: false },
          { id: 20, name: 'Ops Bot', token: 'B...', internal: false },
        ],
      },
    ]);

    const name = await resolveApplicationName(account, 10, { fetchImpl });
    expect(name).toBe('Alert Manager');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const cached = await resolveApplicationName(account, 20, { fetchImpl });
    expect(cached).toBe('Ops Bot');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('resolveApplicationName returns undefined when appId is missing from list', async () => {
    clearApplicationNameCache();
    const fetchImpl = mockFetch([
      {
        ok: true,
        json: async () => [{ id: 1, name: 'App1', token: 'A...', internal: false }],
      },
    ]);

    const name = await resolveApplicationName(account, 999, { fetchImpl });
    expect(name).toBeUndefined();
  });

  it('createApplication', async () => {
    const fetchImpl = mockFetch([
      {
        ok: true,
        json: async () => ({
          id: 5,
          name: 'MyApp',
          token: 'A-new-token',
          description: 'test',
          internal: false,
        }),
      },
    ]);
    const app = await createApplication(
      account,
      { name: 'MyApp', description: 'test', defaultPriority: 7 },
      { fetchImpl }
    );
    expect(app.id).toBe(5);
    expect(app.token).toBe('A-new-token');
    const callInit = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(callInit.method).toBe('POST');
    expect(JSON.parse(callInit.body as string)).toMatchObject({
      name: 'MyApp',
      defaultPriority: 7,
    });
  });

  it('updateApplication', async () => {
    const fetchImpl = mockFetch([
      {
        ok: true,
        json: async () => ({
          id: 5,
          name: 'UpdatedApp',
          token: 'A...',
          description: 'updated',
          internal: false,
        }),
      },
    ]);
    const app = await updateApplication(
      account,
      5,
      { name: 'UpdatedApp', description: 'updated' },
      { fetchImpl }
    );
    expect(app.name).toBe('UpdatedApp');
    expect(fetchImpl.mock.calls[0][0]).toContain('/application/5');
    expect((fetchImpl.mock.calls[0][1] as RequestInit).method).toBe('PUT');
  });

  it('deleteApplication', async () => {
    const fetchImpl = mockFetch([{ ok: true, json: async () => ({}) }]);
    await deleteApplication(account, 5, { fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toContain('/application/5');
    expect((fetchImpl.mock.calls[0][1] as RequestInit).method).toBe('DELETE');
  });

  it('throws when listing applications without clientToken', async () => {
    const noClient = createTestAccount({ clientToken: undefined });
    await expect(listApplications(noClient)).rejects.toThrow(
      'client token required for this operation'
    );
  });
});

// ── Client API Tests ───────────────────────────────────────────────────────────

describe('Client API', () => {
  const account = createTestAccount();

  it('listClients', async () => {
    const fetchImpl = mockFetch([
      {
        ok: true,
        json: async () => [{ id: 1, name: 'MyPhone', token: 'C...' }],
      },
    ]);
    const clients = await listClients(account, { fetchImpl });
    expect(clients).toHaveLength(1);
    expect(clients[0].name).toBe('MyPhone');
  });

  it('createClient', async () => {
    const fetchImpl = mockFetch([
      {
        ok: true,
        json: async () => ({ id: 3, name: 'NewClient', token: 'C-new' }),
      },
    ]);
    const client = await createClient(account, { name: 'NewClient' }, { fetchImpl });
    expect(client.name).toBe('NewClient');
    expect(client.token).toBe('C-new');
    const callInit = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(callInit.method).toBe('POST');
  });

  it('updateClient', async () => {
    const fetchImpl = mockFetch([
      {
        ok: true,
        json: async () => ({ id: 3, name: 'RenamedClient', token: 'C...' }),
      },
    ]);
    const client = await updateClient(account, 3, { name: 'RenamedClient' }, { fetchImpl });
    expect(client.name).toBe('RenamedClient');
    expect(fetchImpl.mock.calls[0][0]).toContain('/client/3');
    expect((fetchImpl.mock.calls[0][1] as RequestInit).method).toBe('PUT');
  });

  it('deleteClient', async () => {
    const fetchImpl = mockFetch([{ ok: true, json: async () => ({}) }]);
    await deleteClient(account, 3, { fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toContain('/client/3');
    expect((fetchImpl.mock.calls[0][1] as RequestInit).method).toBe('DELETE');
  });
});

// ── Health & Doctor Tests ──────────────────────────────────────────────────────

describe('Health & Doctor', () => {
  const account = createTestAccount();

  it('healthCheck returns ok and latency', async () => {
    const fetchImpl = mockFetch([{ ok: true, json: async () => ({}) }]);
    const health = await healthCheck(account, { fetchImpl });
    expect(health.ok).toBe(true);
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('healthCheck returns error on failure', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error('connection refused')) as unknown as typeof fetch;
    const health = await healthCheck(account, { fetchImpl, timeoutMs: 1000 });
    expect(health.ok).toBe(false);
    expect(health.error).toContain('connection refused');
  });

  it('runGotifyDoctor returns full report', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // health
      .mockResolvedValueOnce({ ok: true, json: async () => [] }) // list apps
      .mockResolvedValueOnce({ ok: true, json: async () => [] }); // list clients

    const report = await runGotifyDoctor(account, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(report.ok).toBe(true);
    expect(report.hasAppToken).toBe(true);
    expect(report.hasClientToken).toBe(true);
    expect(report.healthOk).toBe(true);
    expect(report.applicationsChecked).toBe(true);
    expect(report.clientsChecked).toBe(true);
  });

  it('runGotifyDoctor reports missing serverUrl', async () => {
    const noUrl = createTestAccount({ serverUrl: undefined });
    const report = await runGotifyDoctor(noUrl);
    expect(report.ok).toBe(false);
    expect(report.errors).toContain('Missing serverUrl.');
  });

  it('runGotifyDoctor reports missing appToken', async () => {
    const noToken = createTestAccount({ appToken: undefined });
    const fetchImpl = mockFetch([{ ok: true }]);
    const report = await runGotifyDoctor(noToken, { fetchImpl });
    expect(report.errors).toContain('Missing appToken.');
  });
});

describe('dispatchInboundMessage agent fallback', () => {
  it('resolves agent to "main" when resolveAgentRoute returns no agentId', () => {
    function resolveAgent(route: { agentId?: string | null } | null): string {
      return typeof route?.agentId === 'string' && route.agentId.trim() ? route.agentId : 'main';
    }
    expect(resolveAgent(null)).toBe('main');
    expect(resolveAgent({})).toBe('main');
    expect(resolveAgent({ agentId: null })).toBe('main');
    expect(resolveAgent({ agentId: '' })).toBe('main');
    expect(resolveAgent({ agentId: '   ' })).toBe('main');
    expect(resolveAgent({ agentId: 'ops-bot' })).toBe('ops-bot');
  });
});
// ── Message Mapper Tests ───────────────────────────────────────────────────────

describe('message-mapper', () => {
  it('maps outbound to Gotify payload with metadata extras', () => {
    const payload = mapOutboundToGotify({
      text: 'hello',
      title: 'test',
      priority: 7,
      extras: { openclaw: { traceId: 'trace-1' } },
      metadata: { url: 'https://example.com', contentType: 'text/markdown' },
    } as never);

    expect(payload.message).toBe('hello');
    expect(payload.title).toBe('test');
    expect(payload.priority).toBe(7);
    expect(payload.extras).toMatchObject({
      openclaw: { traceId: 'trace-1', source: 'openclaw', outbound: true },
      'client::notification': { click: { url: 'https://example.com' } },
      'client::display': { contentType: 'text/markdown' },
    });
  });

  it('maps outbound without extras when no metadata', () => {
    const payload = mapOutboundToGotify({
      text: 'simple message',
      extras: undefined,
      metadata: {},
    } as never);
    expect(payload.message).toBe('simple message');
    expect(payload.extras).toMatchObject({
      openclaw: { source: 'openclaw', outbound: true },
    });
  });

  it('maps stream envelope to inbound text and metadata', () => {
    const inbound = mapGotifyToInbound({
      id: 11,
      appid: 22,
      message: 'from gotify',
      title: 'alarm',
      priority: 9,
      extras: { openclaw: { peerId: 'peer-1' } },
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

  it('maps empty message to empty string', () => {
    const inbound = mapGotifyToInbound({ id: 0, message: '' });
    expect(inbound.text).toBe('');
  });
});

// ── Outbound Tests ─────────────────────────────────────────────────────────────

describe('outbound', () => {
  it('prefers explicit accountId', () => {
    expect(selectAccountId({ cfg: {}, accountId: 'ops', to: 'default' })).toBe('ops');
  });

  it('falls back to target when accountId is empty', () => {
    expect(selectAccountId({ cfg: {}, accountId: '', to: 'gotify:alerts' })).toBe('alerts');
  });

  it('falls back to default account from config', () => {
    expect(selectAccountId({ cfg: {}, accountId: '', to: '' })).toBe('default');
  });

  it('trims accountId whitespace', () => {
    expect(selectAccountId({ cfg: {}, accountId: '  ops  ', to: 'default' })).toBe('ops');
  });
});

// ── Multi-Account Config Tests ─────────────────────────────────────────────────

describe('multi-account config', () => {
  const cfg = createMultiAccountCfg();

  it('lists all account ids from accounts map', () => {
    expect(listGotifyAccountIds(cfg)).toEqual(['ops', 'alert']);
  });

  it('resolves default account', () => {
    expect(resolveDefaultGotifyAccountId(cfg)).toBe('ops');
  });

  it('resolves ops account with its config', () => {
    const ops = resolveGotifyAccount(cfg, 'ops');
    expect(ops.accountId).toBe('ops');
    expect(ops.serverUrl).toBe('https://ops.example.com');
    expect(ops.appToken).toBe('ops-token');
    expect(ops.clientToken).toBe('ops-client');
    expect(ops.defaultPriority).toBe(5); // default
  });

  it('resolves alert account with custom priority', () => {
    const alert = resolveGotifyAccount(cfg, 'alert');
    expect(alert.accountId).toBe('alert');
    expect(alert.serverUrl).toBe('https://alert.example.com');
    expect(alert.defaultPriority).toBe(9);
  });

  it('resolves unlisted account id from top-level fallback', () => {
    const unknown = resolveGotifyAccount(cfg, 'nonexistent');
    expect(unknown.accountId).toBe('nonexistent');
    expect(unknown.configured).toBe(false);
  });

  it('enables inbound when clientToken present', () => {
    const ops = resolveGotifyAccount(cfg, 'ops');
    expect(ops.inbound.enabled).toBe(true);
  });

  it('disables inbound when no clientToken', () => {
    const cfgNoClient = {
      channels: { gotify: { accounts: { basic: { serverUrl: 'https://x.com', appToken: 'x' } } } },
    };
    const basic = resolveGotifyAccount(cfgNoClient, 'basic');
    expect(basic.inbound.enabled).toBe(false);
  });
});
