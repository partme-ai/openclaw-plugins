/**
 * 抖音渠道插件：createChatChannelPlugin + Gateway HTTP 路由（plugin 鉴权）。
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk/account-resolution";
import { createHybridChannelConfigAdapter } from "openclaw/plugin-sdk/channel-config-helpers";
import { waitUntilAbort } from "openclaw/plugin-sdk/channel-lifecycle";
import { createEmptyChannelResult } from "openclaw/plugin-sdk/channel-send-result";
import { createChatChannelPlugin, type ChannelPlugin } from "openclaw/plugin-sdk/core";
import { createEmptyChannelDirectoryAdapter } from "openclaw/plugin-sdk/directory-runtime";
import { registerPluginHttpRoute } from "openclaw/plugin-sdk/webhook-ingress";
import {
  listDouyinAccountIds,
  resolveDefaultDouyinAccountId,
  resolveDouyinAccount,
} from "./accounts.js";
import { createDouyinPluginHttpHandler } from "./gateway-webhook.js";
import { douyinSetupAdapter } from "./setup.js";
import type { ResolvedDouyinAccount } from "./types.js";

const CHANNEL_ID = "douyin";

const douyinHybridConfig = createHybridChannelConfigAdapter<ResolvedDouyinAccount>({
  sectionKey: CHANNEL_ID,
  listAccountIds: listDouyinAccountIds,
  resolveAccount: resolveDouyinAccount,
  defaultAccountId: resolveDefaultDouyinAccountId,
  clearBaseFields: [
    "app_key",
    "app_secret",
    "shop_id",
    "webhook_path",
    "callback_url",
    "dmPolicy",
    "allowFrom",
    "enabled",
  ],
  resolveAllowFrom: (account: ResolvedDouyinAccount) => account.config.allowFrom,
  formatAllowFrom: (allowFrom: Array<string | number>) =>
    allowFrom.map((entry) => String(entry).trim()).filter(Boolean),
});

const douyinConfig = {
  ...douyinHybridConfig,
  isConfigured: (account: ResolvedDouyinAccount) => account.configured,
  unconfiguredReason: (account: ResolvedDouyinAccount) =>
    account.configured ? "" : "缺少 app_key 或 app_secret",
};

type DouyinGatewayCtx = {
  cfg: OpenClawConfig;
  accountId: string;
  account: ResolvedDouyinAccount;
  abortSignal: AbortSignal;
  log?: {
    info?: (m: string) => void;
    warn?: (m: string) => void;
    error?: (m: string) => void;
    debug?: (m: string) => void;
  };
};

/**
 * 创建抖音 ChannelPlugin（含 Gateway Webhook 注册与入站派发）。
 */
export function createDouyinChannelPlugin(): ChannelPlugin<ResolvedDouyinAccount> {
  return createChatChannelPlugin({
    base: {
      id: CHANNEL_ID,
      meta: {
        id: CHANNEL_ID,
        label: "抖音",
        selectionLabel: "抖音 (Webhook)",
        detailLabel: "抖音开放平台",
        docsPath: "/channels/douyin",
        blurb: "抖音开放平台 Webhook 入站与运营工具",
        order: 120,
      },
      capabilities: {
        chatTypes: ["direct" as const],
        media: false,
        threads: false,
        reactions: false,
        edit: false,
        unsend: false,
        reply: false,
        effects: false,
        blockStreaming: false,
      },
      reload: { configPrefixes: [`channels.${CHANNEL_ID}`] },
      setup: douyinSetupAdapter,
      config: douyinConfig,
      directory: createEmptyChannelDirectoryAdapter(),
      messaging: {
        normalizeTarget: (target: string) => {
          const t = target.trim();
          if (!t) {
            return undefined;
          }
          return t.replace(/^douyin:/i, "").trim();
        },
        targetResolver: {
          looksLikeId: (id: string) => Boolean(id?.trim()),
          hint: "<douyinUserId>",
        },
      },
      gateway: {
        startAccount: async (ctx: DouyinGatewayCtx) => {
          const { account, abortSignal, log } = ctx;
          if (!account.enabled) {
            log?.info?.(`[douyin] account ${account.accountId} disabled; skip webhook`);
            return waitUntilAbort(abortSignal);
          }
          if (!account.configured) {
            log?.warn?.(
              `[douyin] account ${account.accountId} missing app_key/app_secret; webhook will reject traffic`,
            );
          }

          const handler = createDouyinPluginHttpHandler({ account, log });
          const unregister = registerPluginHttpRoute({
            path: account.webhook_path,
            auth: "plugin",
            pluginId: CHANNEL_ID,
            accountId: account.accountId,
            replaceExisting: true,
            log: (m: string) => log?.info?.(m),
            handler,
          });

          log?.info?.(`[douyin] registered HTTP ${account.webhook_path} (account ${account.accountId})`);

          return waitUntilAbort(abortSignal, () => {
            unregister();
            log?.info?.(`[douyin] stopped account ${account.accountId}`);
          });
        },
        stopAccount: async (ctx: DouyinGatewayCtx) => {
          ctx.log?.info?.(`[douyin] stopAccount ${ctx.accountId}`);
        },
      },
      agentPrompt: {
        messageToolHints: () => [
          "",
          "### 抖音渠道",
          "- 入站来自开放平台 Webhook；出站直连发消息需走抖店/OpenAPI，本插件出站为占位。",
        ],
      },
    },
    security: {
      dm: {
        channelKey: CHANNEL_ID,
        resolvePolicy: (a: ResolvedDouyinAccount) => a.config.dmPolicy,
        resolveAllowFrom: (a: ResolvedDouyinAccount) => a.config.allowFrom,
        defaultPolicy: "open",
        approveHint: "openclaw pairing approve douyin <code>",
        normalizeEntry: (raw: string) => raw.trim(),
      },
    },
    outbound: {
      deliveryMode: "gateway",
      textChunkLimit: 4000,
      sendText: async () =>
        createEmptyChannelResult(CHANNEL_ID, {
          messageId: `douyin-outbound-stub-${Date.now()}`,
        }),
    },
  }) as ChannelPlugin<ResolvedDouyinAccount>;
}

export const douyinChannelPlugin = createDouyinChannelPlugin();
