import type { ChannelPlugin, OpenClawConfig } from 'openclaw/plugin-sdk/core';
import type {
  ChannelAccountSnapshot,
  ChannelGatewayContext,
} from 'openclaw/plugin-sdk/channel-contract';
import {
  deleteAccountFromConfigSection,
  setAccountEnabledInConfigSection,
} from 'openclaw/plugin-sdk/core';
import { createScopedDmSecurityResolver } from 'openclaw/plugin-sdk/channel-config-helpers';

import {
  resolveDefaultGotifyAccountId,
  resolveGotifyAccount,
  listGotifyAccountIds,
  describeGotifyAccountSnapshot,
  DEFAULT_GOTIFY_ACCOUNT_ID,
} from './config.js';
import { gotifyOutbound } from './outbound.js';
import { createGotifyWsListener } from './transport/ws-listener.js';
import {
  getAccountSnapshot,
  getOwnApplicationId,
  patchAccountSnapshot,
  setOwnApplicationId,
} from './runtime.js';
import {
  probeGotifyAccount,
  sendGotifyMessageWithDeliveryRetry,
  deleteMessage,
  resolveApplicationName,
} from './transport/gotify-api.js';
import {
  withOpenClawOutboundExtras,
  isOpenClawOutboundStreamMessage,
} from './routing/message-mapper.js';
import { createIdempotencyCache, createTranscriptDispatch, normalizeGotifyIngress, type TranscriptChannelRuntime } from '@partme.ai/openclaw-message-sdk';
import {
  resolveGotifyPeerId,
  resolveGotifyConversationLabel,
  resolveGotifySenderName,
} from './routing/peer-resolver.js';
import { checkGotifyInboundAccess } from './inbound.js';
import { gotifyConfigSchema } from './channel-config.js';
import type { GotifyStreamEnvelope, ResolvedGotifyAccount } from './types.js';
import { gotifySetupAdapter, gotifySetupWizard } from './onboarding.js';

/** WebSocket 监听器实例，按账号 ID 索引。 */
const stopSignals = new Map<string, () => void>();
const listeners = new Map<string, ReturnType<typeof createGotifyWsListener>>();

/** 幂等缓存窗口（毫秒），与 PLUGIN_SPEC 对齐为 60 秒。 */
const DEDUP_WINDOW_MS = 60_000;

/** WebSocket 入站 messageId 去重（message-sdk）。 */
const gotifyDedup = createIdempotencyCache({ ttlMs: DEDUP_WINDOW_MS, maxEntries: 5000 });

/**
 * 清理本模块分配的全部资源。插件被宿主卸载时调用。
 */
export function cleanupGotifyChannel(): void {
  gotifyDedup.clear();
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

const resolveGotifyDmPolicy = createScopedDmSecurityResolver<ResolvedGotifyAccount>({
  channelKey: 'gotify',
  resolvePolicy: (account) => account.dmPolicy,
  resolveAllowFrom: (account) => account.allowFrom,
  defaultPolicy: 'open',
  approveHint: 'openclaw pairing approve gotify <code>',
  normalizeEntry: (raw) =>
    raw
      .replace(/^gotify:/i, '')
      .trim()
      .toLowerCase(),
});

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
  setupWizard: gotifySetupWizard,
  setup: gotifySetupAdapter,
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
    resolveAllowFrom: ({ account }: { account: ResolvedGotifyAccount }) => account.allowFrom,
    formatAllowFrom: ({ allowFrom }: { allowFrom: Array<string | number> }) =>
      allowFrom.map((entry: string | number) => String(entry).trim()).filter(Boolean),
  },
  security: {
    resolveDmPolicy: resolveGotifyDmPolicy,
    collectWarnings: ({ account }: { account: ResolvedGotifyAccount }) => {
      const warnings: string[] = [];
      const dmPolicy = account.dmPolicy ?? 'open';
      if (
        dmPolicy === 'open' &&
        !(account.allowFrom ?? []).some((entry: string) => String(entry).trim() === '*')
      ) {
        warnings.push(
          `- Gotify[${account.accountId}]：dmPolicy="open" 时建议设置 channels.gotify.allowFrom=["*"]，或使用 dmPolicy="allowlist" 限制 appid/peerId。`
        );
      }
      return warnings;
    },
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
    probeAccount: async ({ account }: { account: ResolvedGotifyAccount }) =>
      probeGotifyAccount(account),
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
      const account = ctx.account;
      patchAccountSnapshot(account.accountId, {
        running: account.inbound.enabled,
        lastStartAt: Date.now(),
        lastError: null,
      });
      if (!account.inbound.enabled) {
        return;
      }
      if (!account.clientToken) {
        const error = 'inbound.enabled requires clientToken for WebSocket /stream';
        patchAccountSnapshot(account.accountId, {
          running: false,
          lastError: error,
        });
        ctx.setStatus({
          accountId: account.accountId,
          running: false,
          lastError: error,
        });
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
 * 包含幂等去重：60 秒窗口内相同账号+消息 ID 不会重复派发。
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

  // ── 跳过 OpenClaw 出站回显，避免 Agent 反馈环 ─────────────────────────────
  if (isOpenClawOutboundStreamMessage(message)) {
    return;
  }

  const ownAppId = getOwnApplicationId(account.accountId);
  if (
    ownAppId !== undefined &&
    message.appid !== undefined &&
    String(message.appid) === String(ownAppId)
  ) {
    return;
  }

  // ── 幂等去重（按 messageId，非 peer；成功派发后才写入缓存）────────────────
  const messageId = String(message.id ?? '');
  const dedupKey = messageId ? `${account.accountId}:${messageId}` : '';
  if (dedupKey && gotifyDedup.has(dedupKey)) {
    return;
  }

  const cfg = ctx.cfg as Record<string, unknown>;
  const peerId = resolveGotifyPeerId(message);
  const unified = normalizeGotifyIngress({
    accountId: account.accountId,
    peerId,
    message,
  });

  if (!unified.text.trim()) {
    return;
  }

  const dmAccess = await checkGotifyInboundAccess({
    cfg,
    account,
    peerId,
    appid: message.appid,
  });
  if (!dmAccess.allowed) {
    patchAccountSnapshot(account.accountId, {
      lastError: dmAccess.reason ? `Blocked inbound (${dmAccess.reason})` : 'Blocked inbound',
    });
    return;
  }

  const route = await cr.routing.resolveAgentRoute({
    cfg,
    channel: 'gotify',
    accountId: account.accountId,
    peer: { kind: 'direct', id: peerId },
  });
  const resolvedAgentId =
    typeof route?.agentId === 'string' && route.agentId.trim() ? route.agentId : 'main';
  /** 路由未返回 sessionKey 时按 dmScope 常见形式兜底，避免 transcript 无法写入 Control UI。 */
  const sessionKey =
    typeof route?.sessionKey === 'string' && route.sessionKey.trim()
      ? route.sessionKey
      : `agent:${resolvedAgentId}:gotify:${account.accountId}:direct:${peerId}`;
  const lastRouteSessionKey =
    route?.lastRoutePolicy === 'main' &&
    typeof route?.mainSessionKey === 'string' &&
    route.mainSessionKey.trim()
      ? route.mainSessionKey
      : sessionKey;
  const messageText = unified.text.trim();
  const fromAddress = `gotify:${peerId}`;
  /** 对端地址，用于 lastRoute / OriginatingTo（对齐 Feishu DM：to 指向会话对端而非本账号）。 */
  const peerAddress = fromAddress;

  let resolvedAppName: string | undefined;
  if (message.appid !== undefined && message.appid !== null && account.clientToken) {
    const appId =
      typeof message.appid === 'number' ? message.appid : Number.parseInt(String(message.appid), 10);
    if (Number.isFinite(appId) && appId > 0) {
      resolvedAppName = await resolveApplicationName(account, appId);
    }
  }

  const conversationLabel = resolveGotifyConversationLabel(message, peerId, {
    accountId: account.accountId,
    appName: resolvedAppName,
  });
  const senderName = resolveGotifySenderName(message, peerId, resolvedAppName);
  const nativeDirectUserId =
    message.appid !== undefined && message.appid !== null ? String(message.appid) : undefined;
  const inboundContext = await cr.reply.finalizeInboundContext({
    Body: messageText,
    BodyForAgent: messageText,
    RawBody: messageText,
    CommandBody: messageText,
    From: fromAddress,
    To: peerAddress,
    SessionKey: sessionKey,
    AccountId: account.accountId,
    ChatType: 'direct',
    ConversationLabel: conversationLabel,
    SenderId: peerId,
    SenderName: senderName,
    Provider: 'gotify',
    Surface: 'gotify',
    OriginatingChannel: 'gotify',
    OriginatingTo: peerAddress,
    NativeDirectUserId: nativeDirectUserId,
    MessageSid: messageId || undefined,
    Timestamp: message.date ? Date.parse(message.date) || Date.now() : Date.now(),
    CommandAuthorized: true,
    gotifyAppId: message.appid,
    gotifyMetadata: unified.metadata,
    unifiedMessageId: unified.messageId,
  });

  const storePath =
    cr.session?.resolveStorePath && sessionKey
      ? cr.session.resolveStorePath(
          (cfg as { session?: { store?: string } }).session?.store,
          { agentId: resolvedAgentId }
        )
      : undefined;

  const onRecordError = (err: unknown) => {
    const errorMsg = err instanceof Error ? err.message : String(err);
    patchAccountSnapshot(account.accountId, {
      lastError: `recordInboundSession: ${errorMsg}`,
    });
  };

  const deliverReply = async (payload: { text: string }) => {
    try {
      const response = await sendGotifyMessageWithDeliveryRetry(account, {
        message: payload.text,
        title: message.title ?? resolvedAgentId,
        priority: account.defaultPriority,
        extras: withOpenClawOutboundExtras(),
      });
      if (response.appid !== undefined && response.appid !== null) {
        setOwnApplicationId(account.accountId, response.appid);
      }
      patchAccountSnapshot(account.accountId, {
        lastOutboundAt: Date.now(),
        lastError: null,
      });
      ctx.setStatus({
        accountId: account.accountId,
        lastOutboundAt: Date.now(),
      });
      // 出站：先完成 POST，再删除，保证手机端能收到完整一轮回复后再清理
      await deleteConsumedGotifyMessage(account, { id: response.id });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      patchAccountSnapshot(account.accountId, { lastError: errorMsg });
      ctx.setStatus({
        accountId: account.accountId,
        lastError: errorMsg,
      });
      throw error;
    }
  };

  const updateLastRoute = {
    sessionKey: lastRouteSessionKey,
    channel: 'gotify' as const,
    to: peerAddress,
    accountId: account.accountId,
  };

  if (
    !cr.turn?.runAssembled &&
    (!cr.session?.recordInboundSession || !storePath || !sessionKey)
  ) {
    patchAccountSnapshot(account.accountId, {
      lastError: `Cannot record inbound transcript (missing session API or sessionKey=${sessionKey ?? 'missing'})`,
    });
  }

  await createTranscriptDispatch({
    channelRuntime: cr as TranscriptChannelRuntime,
    cfg,
    channel: 'gotify',
    accountId: account.accountId,
    agentId: resolvedAgentId,
    sessionKey,
    storePath,
    inboundContext,
    record: {
      updateLastRoute,
      onRecordError,
    },
    delivery: {
      deliver: deliverReply,
      onError: (error: unknown) => {
        const errorMsg = error instanceof Error ? error.message : String(error);
        patchAccountSnapshot(account.accountId, { lastError: errorMsg });
      },
    },
  });

  if (dedupKey) {
    gotifyDedup.remember(dedupKey);
  }

  // 入站：在 Agent 回复投递成功后再删除用户消息，避免「先删后答」打断一轮
  await deleteConsumedGotifyMessage(account, message);

  patchAccountSnapshot(account.accountId, {
    lastInboundAt: Date.now(),
    lastError: null,
  });
  ctx.setStatus({
    accountId: account.accountId,
    lastInboundAt: Date.now(),
  });
}

/**
 * 是否应在消息消费后从 Gotify 服务端删除（入站派发成功后、出站回复发送成功后）。
 * 仅当 inbound.deleteAfterConsume=false 时保留消息。
 */
function shouldDeleteAfterConsume(account: ResolvedGotifyAccount): boolean {
  return account.inbound.deleteAfterConsume !== false;
}

/**
 * 消费成功后从 Gotify 服务端删除消息（入站原消息或出站 Agent 回复）。
 * 删除失败仅记录 lastError，不影响已完成的派发/发送。
 */
async function deleteConsumedGotifyMessage(
  account: ResolvedGotifyAccount,
  message: GotifyStreamEnvelope
): Promise<void> {
  if (!shouldDeleteAfterConsume(account)) {
    return;
  }
  if (!account.clientToken) {
    return;
  }
  const rawId = message.id;
  if (rawId === undefined || rawId === null) {
    return;
  }
  const messageId = typeof rawId === 'number' ? rawId : Number.parseInt(String(rawId), 10);
  if (!Number.isFinite(messageId) || messageId <= 0) {
    return;
  }

  try {
    await deleteMessage(account, messageId);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    patchAccountSnapshot(account.accountId, {
      lastError: `deleteMessage(${messageId}): ${errorMsg}`,
    });
  }
}
