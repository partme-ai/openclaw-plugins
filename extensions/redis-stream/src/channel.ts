/**
 * @fileoverview Redis Stream Channel 插件定义。
 *
 * @description
 * Pub/Sub 与 Stream 双模式 ChannelPlugin：账户解析、gateway 生命周期、
 * 出站适配与状态探针的组合导出。
 *
 * @module channel
 */

import {
  getStats,
  startRedisServer,
  stopRedisServer,
} from "./transport/server.js";
import type {
  ChannelAccountSnapshot,
  ChannelGatewayContext,
  ChannelPlugin,
  OpenClawConfig,
} from "openclaw/plugin-sdk";
import { resolveRedisChannelConfig, redactUrl, validateRedisStreamConfig } from "./config.js";
import { redisStreamOutbound } from "./outbound.js";
import {
  redisStreamSetupAdapter,
  redisStreamSetupWizard,
} from "./onboarding.js";

/** @description 默认单账户 ID。 */
export const DEFAULT_ACCOUNT_ID = "default";

type ResolvedRedisStreamAccount = {
  accountId: typeof DEFAULT_ACCOUNT_ID;
  name: string;
  enabled: boolean;
  configured: boolean;
  config: ReturnType<typeof resolveRedisChannelConfig>;
};

function getRedisChannelSection(cfg: OpenClawConfig): Record<string, unknown> | undefined {
  return (cfg.channels as Record<string, unknown> | undefined)?.["redis-stream"] as
    | Record<string, unknown>
    | undefined;
}

function resolveRedisStreamAccount(cfg: OpenClawConfig): ResolvedRedisStreamAccount {
  const rawChannel = getRedisChannelSection(cfg);
  return {
    accountId: DEFAULT_ACCOUNT_ID,
    name: "Redis Stream",
    enabled: rawChannel?.enabled !== false,
    configured: typeof rawChannel?.url === "string" && rawChannel.url.trim().length > 0,
    config: resolveRedisChannelConfig(cfg as unknown as Record<string, unknown>),
  };
}

/** @description Redis Stream ChannelPlugin 实例。 */
export const redisStreamChannel: ChannelPlugin<ResolvedRedisStreamAccount> = {
  id: "redis-stream",

  meta: {
    id: "redis-stream",
    label: "Redis Stream",
    selectionLabel: "Redis Stream (Pub/Sub + Stream)",
    docsPath: "/channels/redis-stream",
    blurb:
      "Redis Pub/Sub channel + Stream consumer group integration for OpenClaw.",
    aliases: ["redis-stream", "redisstream", "redis-channel"],
    order: 92,
  },

  capabilities: {
    chatTypes: ["direct"] as const,
  },

  reload: {
    configPrefixes: ["channels.redis-stream"],
  },

  setupWizard: redisStreamSetupWizard,
  setup: redisStreamSetupAdapter,

  // ── 账户管理 ──────────────────────────────────────────────
  config: {
    listAccountIds: () => [DEFAULT_ACCOUNT_ID],

    resolveAccount: (cfg: OpenClawConfig) => resolveRedisStreamAccount(cfg),

    defaultAccountId: () => DEFAULT_ACCOUNT_ID,

    isConfigured: (account: ResolvedRedisStreamAccount) => account.configured,

    unconfiguredReason: () =>
      "Missing Redis connection URL (channels.redis-stream.url)",
  },

  // ── 生命周期 ──────────────────────────────────────────────
  gateway: {
    startAccount: async ({
      account,
      accountId,
      abortSignal,
      setStatus,
    }: ChannelGatewayContext<ResolvedRedisStreamAccount>) => {
      try {
        const config = account.config;
        validateRedisStreamConfig(config);
        await startRedisServer(config);
        setStatus?.({
          accountId,
          running: true,
          configured: true,
          lastStartAt: Date.now(),
          lastError: null,
        });

        try {
          if (!abortSignal.aborted) {
            await new Promise<void>((resolve) => {
              abortSignal.addEventListener("abort", () => resolve(), { once: true });
            });
          }
        } finally {
          await stopRedisServer();
        }
      } catch (error) {
        setStatus?.({
          accountId,
          running: false,
          configured: true,
          lastError: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },

    stopAccount: async ({
      accountId,
      setStatus,
    }: ChannelGatewayContext<ResolvedRedisStreamAccount>) => {
      try {
        await stopRedisServer();
        setStatus?.({
          accountId,
          running: false,
          configured: true,
          lastStopAt: Date.now(),
          lastError: null,
        });
      } catch (error) {
        setStatus?.({
          accountId,
          running: false,
          configured: true,
          lastError: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  },

  outbound: redisStreamOutbound,

  // ── 会话/线程 ──────────────────────────────────────────────
  threading: {
    resolveReplyToMode: () => "off" as const,
  },

  // ── 群组 / mention ────────────────────────────────────────
  groups: {
    resolveRequireMention: () => false,
  },

  // ── 状态快照 ──────────────────────────────────────────────
  status: {
    buildAccountSnapshot: ({
      account,
      runtime,
    }: {
      account: ResolvedRedisStreamAccount;
      cfg: OpenClawConfig;
      runtime?: ChannelAccountSnapshot;
    }) => {
      return {
        ...runtime,
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: account.configured,
        extra: {
          stats: getStats(),
          config: {
            url: redactUrl(account.config.url),
            channelMode: account.config.channelMode,
            subscribeChannels: account.config.subscribeChannels,
            channelBindings: account.config.channelBindings,
          },
        },
      };
    },

    probeAccount: async ({ account }: { account: ResolvedRedisStreamAccount }) => {
      if (!account.configured) {
        return { reachable: false, reason: "No Redis URL configured" };
      }
      try {
        const s = getStats();
        return {
          reachable: s.connected,
          latencyMs: s.lastReadAt ? Date.now() - s.lastReadAt : undefined,
        };
      } catch {
        return { reachable: false, reason: "Connection probe failed" };
      }
    },
  },
};
