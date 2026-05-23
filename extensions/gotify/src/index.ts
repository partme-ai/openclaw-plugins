/**
 * @partme.ai/openclaw-gotify — OpenClaw Gotify Channel Plugin
 *
 * 入口文件，注册 Gotify 渠道插件并暴露自定义 HTTP 路由。
 *
 * ## registerFull 注册内容
 * - GET /gotify/status  — 所有账号的运行状态与配置快照
 * - GET /gotify/health  — 健康检查（200/503）
 * - GET /gotify/doctor  — 完整诊断报告
 *
 * ## setup entry
 * 轻量 setup-entry.ts 在非 full 模式下提供渠道元数据，
 * 避免导入重量级运行时模块。
 *
 * @packageDocumentation
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

import { gotifyChannel } from "./channel.js";
import {
  resolveGotifyAccount,
  listGotifyAccountIds,
  describeGotifyAccountSnapshot,
} from "./config.js";
import { healthCheck } from "./transport/gotify-api.js";
import { setGotifyRuntime, getAccountSnapshot } from "./runtime.js";
import { doctorGotifyAccount } from "./runtime/bootstrap.js";

export { gotifyChannel } from "./channel.js";
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
} from "./transport/gotify-api.js";
export {
  GotifyApiError,
  GotifyConnectionError,
  GotifyConfigError,
  GotifyWebSocketError,
  GotifyTimeoutError,
} from "./shared/errors.js";
export {
  resolveGotifyAccount,
  resolveDefaultGotifyAccountId,
  listGotifyAccountIds,
  describeGotifyAccountSnapshot,
  DEFAULT_GOTIFY_ACCOUNT_ID,
} from "./config.js";
export {
  mapGotifyToInbound,
  mapOutboundToGotify,
} from "./dispatch/routing/message-mapper.js";
export { createGotifyWsListener } from "./transport/server.js";
export { bootstrapGotifyAccount, doctorGotifyAccount } from "./runtime/bootstrap.js";
export { runConfigWizard } from "./config/config-wizard.js";

/**
 * openclaw-gotify 插件入口 — Gotify channel plugin with REST API + WebSocket stream.
 *
 * @remarks
 * 该入口在 full 模式下注册 HTTP 诊断路由，在 setup-only 模式下由
 * `setup-entry.ts` 提供轻量元数据。`id` 使用包级插件 ID，真正的渠道注册名由
 * `gotifyChannel.id` 固定为 `gotify`。
 */
const gotifyEntry: ReturnType<typeof defineChannelPluginEntry> =
  defineChannelPluginEntry({
    id: "gotify",
    name: "Gotify",
    description:
      "OpenClaw Gotify channel plugin — REST delivery + WebSocket stream with multi-account session isolation.",
    plugin: gotifyChannel,
    setRuntime: setGotifyRuntime,
    /**
     * 注册 Gotify 插件的完整运行时能力。
     *
     * @param api - OpenClaw 插件宿主 API，可注册 HTTP route 并读取 runtime 配置。
     */
    registerFull(api: OpenClawPluginApi) {
      // ── Status endpoint ──────────────────────────────────────────────────────
      api.registerHttpRoute({
        path: "/gotify/status",
        auth: "plugin",
        match: "prefix",
        handler: async (_req: IncomingMessage, res: ServerResponse) => {
          /*
           * status 只返回脱敏配置摘要 + 内存运行态，适合 UI 频繁轮询；
           * 不执行任何网络请求，避免状态页阻塞 Gotify Server 或泄露 token。
           */
          const cfg = (api.runtime as Record<string, unknown> | undefined)
            ?.config as { current?: () => Record<string, unknown> } | undefined;
          const config = cfg?.current?.() ?? {};
          const accounts = listGotifyAccountIds(config).map((accountId) => ({
            ...describeGotifyAccountSnapshot(
              resolveGotifyAccount(config, accountId),
            ),
            runtime: getAccountSnapshot(accountId),
          }));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, data: { accounts } }));
        },
      });

      // ── Health check endpoint ────────────────────────────────────────────────
      api.registerHttpRoute({
        path: "/gotify/health",
        auth: "plugin",
        match: "prefix",
        handler: async (_req: IncomingMessage, res: ServerResponse) => {
          /*
           * health 会主动访问 Gotify /health，因此它可能比 status 慢。
           * 多账号并行检查，整体返回码只有在全部账号健康时才是 200。
           */
          const cfg = (api.runtime as Record<string, unknown> | undefined)
            ?.config as { current?: () => Record<string, unknown> } | undefined;
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
          res.writeHead(allOk ? 200 : 503, {
            "Content-Type": "application/json",
          });
          res.end(JSON.stringify({ ok: allOk, data: { accounts: results } }));
        },
      });

      // ── Doctor endpoint ──────────────────────────────────────────────────────
      api.registerHttpRoute({
        path: "/gotify/doctor",
        auth: "plugin",
        match: "prefix",
        handler: async (_req: IncomingMessage, res: ServerResponse) => {
          /*
           * doctor 会检查 Application/Client API，可帮助 operator 判断 clientToken 权限。
           * 该路由使用 plugin auth，避免诊断信息被未授权访问。
           */
          const cfg = (api.runtime as Record<string, unknown> | undefined)
            ?.config as { current?: () => Record<string, unknown> } | undefined;
          const config = cfg?.current?.() ?? {};
          const reports = await Promise.all(
            listGotifyAccountIds(config).map(async (accountId) =>
              doctorGotifyAccount(resolveGotifyAccount(config, accountId)),
            ),
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ ok: reports.every((r) => r.ok), data: reports }),
          );
        },
      });

      // Plugin registered — Gotify channel ready
    },
  });

export default gotifyEntry;
