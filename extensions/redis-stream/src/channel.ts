/**
 * Redis Channel/Stream channel 插件定义。
 *
 * 完整的 ChannelPlugin：生命周期、账户管理、出站发送、状态快照、dmScope 会话隔离。
 */

import { getStats, startRedisServer, stopRedisServer } from "./redis-stream-server.js";
import { publishMessage, publishEntry } from "./publisher.js";
import { resolveRedisChannelConfig, redactUrl } from "./redis-stream-config.js";

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

  // ── 出站发送 ──────────────────────────────────────────────
  outbound: {
    deliveryMode: "direct" as const,

    sendText: async (ctx: { cfg: Record<string, unknown>; text: string }) => {
      const config = resolveRedisChannelConfig(ctx.cfg);

      if (config.channelMode === "stream") {
        const id = await publishEntry(config.stream.outboundKey, {
          [config.fieldMapping.textField]: ctx.text,
        });
        return { channel: "redis-stream", messageId: id };
      }

      // Pub/Sub 模式：发布到标准出站 channel
      // 注意：sendText ctx 不包含 replyChannel —— 有状态的回复通过 dispatchToRuntime 中的 dispatcher 处理
      const channel = `openclaw:agent:outbound`;
      await publishMessage(channel, ctx.text);
      return { channel: "redis-stream", messageId: `${channel}:${Date.now()}` };
    },
  },

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
