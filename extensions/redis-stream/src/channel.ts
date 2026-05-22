/**
 * Redis Channel/Stream channel 插件定义。
 *
 * 完整的 ChannelPlugin：生命周期、账户管理、出站发送、状态快照、dmScope 会话隔离。
 */

import { getStats, startRedisServer, stopRedisServer } from "./transport/server.js";
import { resolveRedisChannelConfig, redactUrl } from "./config.js";
import { redisStreamOutbound } from "./outbound.js";
import { redisStreamSetupAdapter, redisStreamSetupWizard } from "./onboarding.js";

export const DEFAULT_ACCOUNT_ID = "default";

export const redisStreamChannel = {
  id: "redis-stream",
  name: "Redis Stream",

  meta: {
    id: "redis-stream",
    label: "Redis Stream",
    selectionLabel: "Redis Stream (Pub/Sub + Stream)",
    docsPath: "/channels/redis-stream",
    blurb: "Redis Pub/Sub channel + Stream consumer group integration for OpenClaw.",
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
    listAccountIds: () => {
      return [DEFAULT_ACCOUNT_ID];
    },

    resolveAccount: (cfg: Record<string, unknown>) => {
      const rawChannel = ((cfg.channels as Record<string, unknown> | undefined) ?? {})["redis-stream"] as
        | Record<string, unknown>
        | undefined;
      return {
        accountId: DEFAULT_ACCOUNT_ID,
        name: "Redis Stream",
        enabled: true,
        configured: Boolean(rawChannel?.url),
      };
    },

    defaultAccountId: () => DEFAULT_ACCOUNT_ID,

    isConfigured: (cfg: Record<string, unknown>) => {
      const rawChannel = ((cfg.channels as Record<string, unknown> | undefined) ?? {})["redis-stream"] as
        | Record<string, unknown>
        | undefined;
      return Boolean(rawChannel?.url);
    },

    unconfiguredReason: (cfg: Record<string, unknown>) => {
      const rawChannel = ((cfg.channels as Record<string, unknown> | undefined) ?? {})["redis-stream"] as
        | Record<string, unknown>
        | undefined;
      if (!rawChannel?.url) return "Missing Redis connection URL (channels.redis-stream.url)";
      return null;
    },
  },

  // ── 生命周期 ──────────────────────────────────────────────
  gateway: {
    startAccount: async ({
      runtime,
      abortSignal,
      setStatus,
    }: {
      runtime: { config: Record<string, unknown> };
      abortSignal: AbortSignal;
      setStatus: (status: Record<string, unknown>) => void;
    }) => {
      try {
        const config = resolveRedisChannelConfig(runtime.config);
        await startRedisServer(config);
        setStatus?.({
          running: true,
          configured: true,
          lastStartAt: Date.now(),
          lastError: null,
        });

        await new Promise<void>((resolve) => {
          abortSignal.addEventListener("abort", () => resolve(), { once: true });
        });

        await stopRedisServer();
      } catch (error) {
        setStatus?.({
          running: false,
          configured: true,
          lastError: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },

    stopAccount: async ({ setStatus }: { setStatus: (status: Record<string, unknown>) => void }) => {
      try {
        await stopRedisServer();
        setStatus?.({
          running: false,
          configured: true,
          lastStopAt: Date.now(),
          lastError: null,
        });
      } catch (error) {
        setStatus?.({
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
    buildAccountSnapshot: (cfg: Record<string, unknown>) => {
      const config = resolveRedisChannelConfig(cfg);
      const rawChannel = ((cfg.channels as Record<string, unknown> | undefined) ?? {})["redis-stream"] as
        | Record<string, unknown>
        | undefined;
      return {
        accountId: DEFAULT_ACCOUNT_ID,
        name: "Redis Stream",
        enabled: true,
        configured: Boolean(rawChannel?.url),
        extra: {
          stats: getStats(),
          config: {
            url: redactUrl(config.url),
            channelMode: config.channelMode,
            subscribeChannels: config.subscribeChannels,
            channelBindings: config.channelBindings,
          },
        },
      };
    },

    probeAccount: async (cfg: Record<string, unknown>) => {
      const rawChannel = ((cfg.channels as Record<string, unknown> | undefined) ?? {})["redis-stream"] as
        | Record<string, unknown>
        | undefined;
      if (!rawChannel?.url) {
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
