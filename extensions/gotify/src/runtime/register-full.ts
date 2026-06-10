/**
 * @file Gotify full-mode HTTP 路由注册器。
 *
 * @description 当插件以 **full** bundle 加载时，向 OpenClaw Host 注册只读 JSON 端点：
 * `/gotify/status`（账号+runtime 聚合）、`/gotify/health`（逐账号 `/health`）、
 * `/gotify/doctor`（深度诊断列表）。全部 `auth: "plugin"`。
 * **模块角色**：Channel Plugin · Observability HTTP surface。
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
 * 向 Host 注册上述诊断路由（幂等由 Host 侧保证）。
 *
 * @description Handler 内通过 `api.runtime.config.current()` 拉取最新配置快照；
 * 不做敏感 token 回传（`describeGotifyAccountSnapshot` 已脱敏 serverUrl）。
 * @param api - `OpenClawPluginApi` —— 提供 `registerHttpRoute` 与 `runtime` 句柄。
 * @returns `void`
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
