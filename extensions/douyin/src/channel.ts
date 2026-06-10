/**
 * 抖音渠道插件定义 — `ChannelPlugin` 装配层。
 *
 * **架构角色**：将抖音业务配置、Gateway 生命周期、Webhook 路由、DM 安全策略
 * 与出站占位整合为 OpenClaw 标准 `createChatChannelPlugin` 实例。
 *
 * **关键依赖**：`openclaw/plugin-sdk/*`、`./config`、`./inbound`、`./onboarding`、`./outbound`
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk/account-resolution";
import { createHybridChannelConfigAdapter } from "openclaw/plugin-sdk/channel-config-helpers";
import { waitUntilAbort } from "openclaw/plugin-sdk/channel-lifecycle";
import { sendDouyinOutboundStub } from "./outbound.js";
import { createChatChannelPlugin, type ChannelPlugin } from "openclaw/plugin-sdk/core";
import { createEmptyChannelDirectoryAdapter } from "openclaw/plugin-sdk/directory-runtime";
import { registerPluginHttpRoute } from "openclaw/plugin-sdk/webhook-ingress";
import {
  listDouyinAccountIds,
  resolveDefaultDouyinAccountId,
  resolveDouyinAccount,
} from "./config.js";
import { createDouyinPluginHttpHandler } from "./inbound.js";
import { douyinSetupAdapter, douyinSetupWizard } from "./onboarding.js";
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

/** Gateway `startAccount` / `stopAccount` 上下文（由 OpenClaw 注入） */
type DouyinGatewayCtx = {
  /** 全局 OpenClaw 配置快照 */
  cfg: OpenClawConfig;
  /** 当前启动的账号 id */
  accountId: string;
  /** 已合并 base + account 覆盖的解析结果 */
  account: ResolvedDouyinAccount;
  /** 账号停止信号，用于 `waitUntilAbort` 挂起生命周期 */
  abortSignal: AbortSignal;
  /** 可选结构化日志（Gateway 注入） */
  log?: {
    info?: (m: string) => void;
    warn?: (m: string) => void;
    error?: (m: string) => void;
    debug?: (m: string) => void;
  };
};

/**
 * 创建抖音 `ChannelPlugin` 实例（含 Gateway Webhook 注册与入站派发）。
 *
 * @returns 可直接注册到 OpenClaw 的渠道插件对象
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
      setupWizard: douyinSetupWizard,
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
          // 账号禁用时仅挂起生命周期，不注册 Webhook 路由
          if (!account.enabled) {
            log?.info?.(`[douyin] account ${account.accountId} disabled; skip webhook`);
            return waitUntilAbort(abortSignal);
          }
          // 未配置凭据仍注册路由，入站 handler 会因验签失败返回 401
          if (!account.configured) {
            log?.warn?.(
              `[douyin] account ${account.accountId} missing app_key/app_secret; webhook will reject traffic`,
            );
          }

          const handler = createDouyinPluginHttpHandler({ account, log });
          // plugin 鉴权：由 OpenClaw Gateway 校验插件身份后再转发至 handler
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
      sendText: async () => sendDouyinOutboundStub(),
    },
  }) as ChannelPlugin<ResolvedDouyinAccount>;
}

/** 模块级单例，供 `index.ts` / `setup-entry.ts` 直接引用 */
export const douyinChannelPlugin = createDouyinChannelPlugin();
