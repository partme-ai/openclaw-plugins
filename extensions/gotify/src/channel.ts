import type {
  ChannelAccountSnapshot,
  ChannelGatewayContext,
  ChannelPlugin,
  OpenClawConfig,
} from 'openclaw/plugin-sdk';
import {
  deleteAccountFromConfigSection,
  setAccountEnabledInConfigSection,
} from 'openclaw/plugin-sdk';

import {
  resolveDefaultGotifyAccountId,
  resolveGotifyAccount,
  listGotifyAccountIds,
  describeGotifyAccountSnapshot,
  DEFAULT_GOTIFY_ACCOUNT_ID,
} from './config.js';
import { gotifyOutbound } from './outbound.js';
import { createGotifyWsListener } from './ws-listener.js';
import { getAccountSnapshot, patchAccountSnapshot } from './runtime.js';
import { sendGotifyMessage } from './gotify-api.js';
import { mapGotifyToInbound } from './message-mapper.js';
import { gotifyConfigSchema } from './channel-config.js';
import type { GotifyStreamEnvelope, ResolvedGotifyAccount } from './types.js';

/** WebSocket 监听器实例，按账号 ID 索引。 */
const stopSignals = new Map<string, () => void>();
const listeners = new Map<string, ReturnType<typeof createGotifyWsListener>>();

/** 消息幂等去重表：messageId → 到期时间戳（ms）。 */
const dedupCache = new Map<string, number>();

/** 幂等缓存窗口（毫秒），同一账号内 30 秒内相同 ID 视为重复。 */
const DEDUP_WINDOW_MS = 30_000;

/**
 * 清理过期幂等缓存条目。
 * 每隔 60 秒调用一次即可。
 */
function cleanDedupCache(): void {
  const now = Date.now();
  for (const [id, expiresAt] of dedupCache.entries()) {
    if (expiresAt < now) {
      dedupCache.delete(id);
    }
  }
}

/** 惰性初始化的清理定时器，仅当插件实际启动时创建。 */
let dedupCleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureDedupCleanupTimer(): void {
  if (dedupCleanupTimer === null) {
    dedupCleanupTimer = setInterval(cleanDedupCache, 60_000);
  }
}

/**
 * 清理本模块分配的全部资源。插件被宿主卸载时调用。
 */
export function cleanupGotifyChannel(): void {
  if (dedupCleanupTimer !== null) {
    clearInterval(dedupCleanupTimer);
    dedupCleanupTimer = null;
  }
  dedupCache.clear();
  for (const resolve of stopSignals.values()) resolve();
  stopSignals.clear();
  for (const listener of listeners.values()) {
    listener.stop();
  }
  listeners.clear();
}

const meta = {
  id: 'gotify',
  label: 'Gotify',
  selectionLabel: 'Gotify (plugin)',
  docsPath: '/channels/gotify',
  docsLabel: 'gotify',
  blurb: 'Gotify channel plugin with REST delivery, stream listener, and bootstrap helpers.',
  aliases: ['gotify'],
  order: 90,
  quickstartAllowFrom: false,
};

/**
 * 规范化主动消息目标，仅保留账号 ID。
 */
function normalizeGotifyMessagingTarget(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^gotify:/i, '').trim() || undefined;
}

/**
 * Gotify 渠道插件定义。
 */
export const gotifyChannel: ChannelPlugin<ResolvedGotifyAccount> = {
  id: 'gotify',
  meta,
  capabilities: {
    chatTypes: ['direct'],
    media: false,
    reactions: false,
    threads: false,
    polls: false,
    nativeCommands: false,
    blockStreaming: true,
  },
  reload: { configPrefixes: ['channels.gotify', 'session.dmScope'] },
  configSchema: gotifyConfigSchema,
  config: {
    listAccountIds: (cfg: OpenClawConfig) => listGotifyAccountIds(cfg),
    resolveAccount: (cfg: OpenClawConfig, accountId?: string | null) =>
      resolveGotifyAccount(cfg, accountId),
    defaultAccountId: (cfg: OpenClawConfig) => resolveDefaultGotifyAccountId(cfg),
    setAccountEnabled: ({
      cfg,
      accountId,
      enabled,
    }: {
      cfg: OpenClawConfig;
      accountId: string;
      enabled: boolean;
    }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: 'gotify',
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }: { cfg: OpenClawConfig; accountId: string }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: 'gotify',
        accountId,
        clearBaseFields: ['serverUrl', 'appToken', 'clientToken'],
      }),
    isConfigured: (account: ResolvedGotifyAccount) => account.configured,
    unconfiguredReason: () => 'channels.gotify missing serverUrl or appToken',
    describeAccount: (account: ResolvedGotifyAccount): ChannelAccountSnapshot =>
      describeGotifyAccountSnapshot(account),
  },
  groups: {
    resolveRequireMention: () => false,
  },
  threading: {
    resolveReplyToMode: () => 'off',
  },
  messaging: {
    normalizeTarget: normalizeGotifyMessagingTarget,
    targetResolver: {
      looksLikeId: (raw: string) => Boolean(raw.trim()),
      hint: '<accountId>',
    },
  },
  outbound: {
    ...gotifyOutbound,
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_GOTIFY_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildChannelSummary: ({ snapshot }: { snapshot: ChannelAccountSnapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      webhookPath: snapshot.webhookPath ?? null,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      lastInboundAt: snapshot.lastInboundAt ?? null,
      lastOutboundAt: snapshot.lastOutboundAt ?? null,
    }),
    probeAccount: async () => ({ ok: true }),
    buildAccountSnapshot: ({ account }: { account: ResolvedGotifyAccount }) => ({
      ...describeGotifyAccountSnapshot(account),
      ...getAccountSnapshot(account.accountId),
    }),
  },
  gateway: {
    /**
     * 启动账号时根据配置决定是否建立 WebSocket 监听。
     */
    async startAccount(ctx: ChannelGatewayContext<ResolvedGotifyAccount>) {
      ensureDedupCleanupTimer();
      const account = ctx.account;
      patchAccountSnapshot(account.accountId, {
        running: account.inbound.enabled,
        lastStartAt: Date.now(),
        lastError: null,
      });
      if (!account.inbound.enabled) {
        return;
      }
      const listener = createGotifyWsListener(account, {
        onMessage: async (message) => {
          await dispatchInboundMessage(ctx, account, message);
        },
        onStateChange: (state) => {
          patchAccountSnapshot(account.accountId, {
            running: state.running,
            lastError: state.lastError ?? null,
          });
          ctx.setStatus({
            accountId: account.accountId,
            running: state.running,
            lastError: state.lastError ?? null,
          });
        },
      });
      listeners.get(account.accountId)?.stop();
      listeners.set(account.accountId, listener);
      await listener.start();
      await new Promise<void>((resolve) => {
        stopSignals.get(account.accountId)?.();
        stopSignals.set(account.accountId, resolve);
      });
    },
    async stopAccount(ctx: ChannelGatewayContext<ResolvedGotifyAccount>) {
      stopSignals.get(ctx.account.accountId)?.();
      stopSignals.delete(ctx.account.accountId);
      listeners.get(ctx.account.accountId)?.stop();
      listeners.delete(ctx.account.accountId);
      patchAccountSnapshot(ctx.account.accountId, {
        running: false,
        lastStopAt: Date.now(),
      });
      ctx.setStatus({
        accountId: ctx.account.accountId,
        running: false,
        lastStopAt: Date.now(),
      });
    },
  },
};

/**
 * 将 Gotify 入站流消息派发到 OpenClaw 运行时。
 * 包含幂等去重：30 秒窗口内相同消息 ID 不会重复派发。
 */
export async function dispatchInboundMessage(
  ctx: ChannelGatewayContext<ResolvedGotifyAccount>,
  account: ResolvedGotifyAccount,
  message: GotifyStreamEnvelope
): Promise<void> {
  const cr = ctx.channelRuntime;
  if (!cr?.reply || !cr?.routing) {
    patchAccountSnapshot(account.accountId, {
      lastError: 'channelRuntime does not expose reply/routing.',
    });
    return;
  }

  // ── 幂等去重 ────────────────────────────────────────────────────────────────
  const messageId = String(message.id ?? '');
  if (messageId) {
    const seen = dedupCache.get(messageId);
    if (seen !== undefined && seen > Date.now() - DEDUP_WINDOW_MS) {
      return;
    }
    dedupCache.set(messageId, Date.now() + DEDUP_WINDOW_MS);
  }

  const cfg = ctx.cfg as Record<string, unknown>;
  const extraPeerId = (message.extras?.openclaw as Record<string, unknown> | undefined)?.peerId;
  const peerId =
    typeof extraPeerId === 'string' && extraPeerId.trim()
      ? extraPeerId.trim().toLowerCase()
      : String(message.appid || 'unknown');
  const inbound = mapGotifyToInbound(message);
  const route = await cr.routing.resolveAgentRoute({
    cfg,
    channel: 'gotify',
    accountId: account.accountId,
    peer: { kind: 'direct', id: peerId },
  });
  const resolvedAgentId =
    typeof route?.agentId === 'string' && route.agentId.trim() ? route.agentId : 'main';
  const sessionKey = route.sessionKey;
  const inboundContext = await cr.reply.finalizeInboundContext({
    channel: 'gotify',
    accountId: account.accountId,
    from: peerId,
    text: inbound.text,
    chatType: 'direct',
    extra: {
      gotifyMessageId: message.id,
      gotifyAppId: message.appid,
      sessionKey,
      gotifyMetadata: inbound.metadata,
    },
  });
  await cr.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: inboundContext,
    cfg,
    dispatcherOptions: {
      deliver: async (payload: { text: string }) => {
        await sendGotifyMessage(account, {
          message: payload.text,
          title: message.title ?? resolvedAgentId,
          priority: account.defaultPriority,
        });
        patchAccountSnapshot(account.accountId, {
          lastOutboundAt: Date.now(),
          lastError: null,
        });
      },
    },
    replyOptions: route,
  });
  patchAccountSnapshot(account.accountId, {
    lastInboundAt: Date.now(),
    lastError: null,
  });
}
