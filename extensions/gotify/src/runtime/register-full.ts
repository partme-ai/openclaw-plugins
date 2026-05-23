/**
 * Gotify full 模式注册：HTTP 诊断路由（status / health / doctor）。
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

import {
  describeGotifyAccountSnapshot,
  listGotifyAccountIds,
  resolveGotifyAccount,
} from "../config.js";
import { getAccountSnapshot } from "../runtime.js";
import { doctorGotifyAccount } from "./bootstrap.js";
import { healthCheck } from "../transport/gotify-api.js";

/**
 * 注册 Gotify 插件 full 模式 HTTP 路由。
 *
 * @param api - OpenClaw 插件宿主 API。
 */
export function registerGotifyFull(api: OpenClawPluginApi): void {
  api.registerHttpRoute({
    path: "/gotify/status",
    auth: "plugin",
    match: "prefix",
    handler: async (_req: IncomingMessage, res: ServerResponse) => {
      const cfg = (api.runtime as Record<string, unknown> | undefined)?.config as
        | { current?: () => Record<string, unknown> }
        | undefined;
      const config = cfg?.current?.() ?? {};
      const accounts = listGotifyAccountIds(config).map((accountId) => ({
        ...describeGotifyAccountSnapshot(resolveGotifyAccount(config, accountId)),
        runtime: getAccountSnapshot(accountId),
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, data: { accounts } }));
    },
  });

  api.registerHttpRoute({
    path: "/gotify/health",
    auth: "plugin",
    match: "prefix",
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
            : { ok: false, latencyMs: 0, error: "Not configured" };
          return { accountId, ...health };
        }),
      );
      const allOk = results.every((r) => r.ok);
      res.writeHead(allOk ? 200 : 503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: allOk, data: { accounts: results } }));
    },
  });

  api.registerHttpRoute({
    path: "/gotify/doctor",
    auth: "plugin",
    match: "prefix",
    handler: async (_req: IncomingMessage, res: ServerResponse) => {
      const cfg = (api.runtime as Record<string, unknown> | undefined)?.config as
        | { current?: () => Record<string, unknown> }
        | undefined;
      const config = cfg?.current?.() ?? {};
      const reports = await Promise.all(
        listGotifyAccountIds(config).map(async (accountId) =>
          doctorGotifyAccount(resolveGotifyAccount(config, accountId)),
        ),
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: reports.every((r) => r.ok), data: reports }));
    },
  });
}
