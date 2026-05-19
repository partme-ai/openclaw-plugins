import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineChannelPluginEntry } from 'openclaw/plugin-sdk/channel-core';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';

import { gotifyChannel } from './channel.js';
import {
  resolveGotifyAccount,
  listGotifyAccountIds,
  describeGotifyAccountSnapshot,
} from './config.js';
import { healthCheck } from './gotify-api.js';
import { setGotifyRuntime, getAccountSnapshot } from './runtime.js';
import { doctorGotifyAccount } from './setup.js';

export { gotifyChannel } from './channel.js';
export {
  sendGotifyMessage,
  getMessages,
  deleteAllMessages,
  deleteMessage,
  getApplicationMessages,
  deleteApplicationMessages,
  listApplications,
  createApplication,
  updateApplication,
  deleteApplication,
  uploadApplicationImage,
  listClients,
  createClient,
  updateClient,
  deleteClient,
  healthCheck,
  runGotifyDoctor,
  buildMessageRequest,
  normalizeServerUrl,
} from './gotify-api.js';
export {
  resolveGotifyAccount,
  resolveDefaultGotifyAccountId,
  listGotifyAccountIds,
  describeGotifyAccountSnapshot,
  DEFAULT_GOTIFY_ACCOUNT_ID,
} from './config.js';
export { mapGotifyToInbound, mapOutboundToGotify } from './message-mapper.js';
export { createGotifyWsListener } from './ws-listener.js';
export { bootstrapGotifyAccount, doctorGotifyAccount } from './setup.js';
export { runConfigWizard } from './config-wizard.js';

/**
 * openclaw-gotify 插件入口 — Gotify channel plugin with REST API + WebSocket stream.
 */
export default defineChannelPluginEntry({
  id: 'openclaw-gotify',
  name: 'Gotify',
  description:
    'OpenClaw Gotify channel plugin — REST delivery + WebSocket stream with multi-account session isolation.',
  plugin: gotifyChannel,
  setRuntime: setGotifyRuntime,
  registerFull(api: OpenClawPluginApi) {
    // ── Status endpoint ──────────────────────────────────────────────────────
    api.registerHttpRoute({
      path: '/gotify/status',
      auth: 'plugin',
      match: 'prefix',
      handler: async (_req: IncomingMessage, res: ServerResponse) => {
        const cfg = (api.runtime as Record<string, unknown> | undefined)?.config as
          | { current?: () => Record<string, unknown> }
          | undefined;
        const config = cfg?.current?.() ?? {};
        const accounts = listGotifyAccountIds(config).map((accountId) => ({
          ...describeGotifyAccountSnapshot(resolveGotifyAccount(config, accountId)),
          runtime: getAccountSnapshot(accountId),
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, data: { accounts } }));
      },
    });

    // ── Health check endpoint ────────────────────────────────────────────────
    api.registerHttpRoute({
      path: '/gotify/health',
      auth: 'plugin',
      match: 'prefix',
      handler: async (_req: IncomingMessage, res: ServerResponse) => {
        const cfg = (api.runtime as Record<string, unknown> | undefined)?.config as
          | { current?: () => Record<string, unknown> }
          | undefined;
        const config = cfg?.current?.() ?? {};
        const accounts = listGotifyAccountIds(config);
        const results = await Promise.all(
          accounts.map(async (accountId) => {
            const account = resolveGotifyAccount(config, accountId);
            const health = account.configured
              ? await healthCheck(account)
              : { ok: false, latencyMs: 0, error: 'Not configured' };
            return { accountId, ...health };
          })
        );
        const allOk = results.every((r) => r.ok);
        res.writeHead(allOk ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: allOk, data: { accounts: results } }));
      },
    });

    // ── Doctor endpoint ──────────────────────────────────────────────────────
    api.registerHttpRoute({
      path: '/gotify/doctor',
      auth: 'plugin',
      match: 'prefix',
      handler: async (_req: IncomingMessage, res: ServerResponse) => {
        const cfg = (api.runtime as Record<string, unknown> | undefined)?.config as
          | { current?: () => Record<string, unknown> }
          | undefined;
        const config = cfg?.current?.() ?? {};
        const reports = await Promise.all(
          listGotifyAccountIds(config).map(async (accountId) =>
            doctorGotifyAccount(resolveGotifyAccount(config, accountId))
          )
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: reports.every((r) => r.ok), data: reports }));
      },
    });

    // Plugin registered — Gotify channel ready
  },
});
