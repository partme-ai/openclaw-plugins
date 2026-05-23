/**
 * Gotify Channel — ChannelPlugin 完整实现。
 *
 * 负责渠道生命周期管理、消息收发、DM 访问控制、状态上报。
 *
 * ## 入站流程
 * WebSocket /stream 连接 → Zod 校验 → 自我回显过滤 → 幂等去重 →
 * DM 访问控制 → Agent 路由 → Transcript 派发 → 消费后删除
 *
 * ## 出站流程
 * sendText → 消息格式映射 → POST /message (appToken) → 回写 Application ID 缓存
 *
 * ## 关键设计
 * - 自我回显防护：出站消息自动注入 extras.openclaw.outbound 标记，入站时过滤
 * - 幂等去重：60s 窗口，按 accountId:messageId 去重
 * - 消费后删除：入站派发成功 + 出站回复成功 后从 Gotify 服务端删除消息
 * - 账号级并发锁：同一账号的 API 请求串行执行
 */

import type { ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk/core";
import type {
  ChannelAccountSnapshot,
  ChannelGatewayContext,
  ChannelRuntimeSurface,
} from "openclaw/plugin-sdk/channel-contract";
import {
  deleteAccountFromConfigSection,
  setAccountEnabledInConfigSection,
} from "openclaw/plugin-sdk/core";
import { createScopedDmSecurityResolver } from "openclaw/plugin-sdk/channel-config-helpers";

import {
  resolveDefaultGotifyAccountId,
  resolveGotifyAccount,
  listGotifyAccountIds,
  describeGotifyAccountSnapshot,
  DEFAULT_GOTIFY_ACCOUNT_ID,
} from "../config.js";
import { gotifyOutbound } from "../outbound.js";
import { createGotifyWsListener } from "../transport/ws-listener.js";
import {
  getAccountSnapshot,
  getOwnApplicationId,
  patchAccountSnapshot,
  setOwnApplicationId,
} from "../runtime.js";
import {
  probeGotifyAccount,
  sendGotifyMessageWithDeliveryRetry,
  deleteMessage,
  resolveApplicationName,
} from "../transport/gotify-api.js";
import { replayBacklogForAccount } from "../dispatch/backlog-replay.js";
import { writeBacklogCursor } from "../dispatch/backlog-cursor.js";
import {
  withOpenClawOutboundExtras,
  isOpenClawOutboundStreamMessage,
  mapGotifyStreamToUnified,
} from "../dispatch/routing/message-mapper.js";
import {
  createIdempotencyCache,
  dispatchTranscriptTurn,
  type TranscriptChannelRuntime,
} from "@partme.ai/openclaw-message-sdk";
import {
  resolveGotifyPeerId,
  resolveGotifyConversationLabel,
  resolveGotifySenderName,
} from "../dispatch/routing/peer-resolver.js";
import { checkGotifyInboundAccess } from "../inbound.js";
import { gotifyConfigSchema } from "../config/channel-config.js";
import type { GotifyStreamEnvelope, ResolvedGotifyAccount } from "../types.js";
import { gotifySetupAdapter, gotifySetupWizard } from "../onboarding.js";

/** WebSocket 监听器实例，按账号 ID 索引。 */
const stopSignals = new Map<string, () => void>();
const listeners = new Map<string, ReturnType<typeof createGotifyWsListener>>();
const inboundQueues = new Map<string, Promise<void>>();

/** 幂等缓存窗口（毫秒），与 PLUGIN_SPEC 对齐为 60 秒。 */
const DEDUP_WINDOW_MS = 60_000;

type GotifyAgentRoute = {
  agentId?: string;
  sessionKey?: string;
  lastRoutePolicy?: string;
  mainSessionKey?: string;
};

type GotifyChannelRuntime = ChannelRuntimeSurface & {
  routing?: {
    resolveAgentRoute: (params: {
      cfg: OpenClawConfig;
      channel: string;
      accountId: string;
      peer: { kind: "direct" | "group"; id: string };
    }) => Promise<GotifyAgentRoute>;
  };
  reply?: TranscriptChannelRuntime["reply"] & {
    finalizeInboundContext: (
      params: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;
  };
  session?: TranscriptChannelRuntime["session"];
  turn?: TranscriptChannelRuntime["turn"];
};

/** WebSocket 入站 messageId 去重（message-sdk）。 */
const gotifyDedup = createIdempotencyCache({
  ttlMs: DEDUP_WINDOW_MS,
  maxEntries: 5000,
});

/**
 * 清理本模块分配的全部资源。插件被宿主卸载时调用。
 *
 * @returns 无返回值；所有内存 listener、stop signal 和幂等缓存都会被清理。
 */
export function cleanupGotifyChannel(): void {
  gotifyDedup.clear();
  for (const resolve of stopSignals.values()) resolve();
  stopSignals.clear();
  for (const listener of listeners.values()) {
    listener.stop();
  }
  listeners.clear();
  inboundQueues.clear();
}

function parsePositiveMessageId(id: number | string | undefined): number {
  const normalized =
    typeof id === "number" ? Math.trunc(id) : Number.parseInt(String(id ?? ""), 10);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : 0;
}

function enqueueInbound(accountId: string, task: () => Promise<void>): Promise<void> {
  const previous = inboundQueues.get(accountId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(task);
  const tracked = next.finally(() => {
    if (inboundQueues.get(accountId) === tracked) {
      inboundQueues.delete(accountId);
    }
  });
  inboundQueues.set(accountId, tracked);
  return tracked;
}

const meta = {
  id: "gotify",
  label: "Gotify",
  selectionLabel: "Gotify (plugin)",
  docsPath: "/channels/gotify",
  docsLabel: "gotify",
  blurb:
    "Gotify channel plugin with REST delivery, stream listener, and bootstrap helpers.",
  aliases: ["gotify"],
  order: 90,
  quickstartAllowFrom: false,
};

/**
 * 规范化主动消息目标，仅保留账号 ID。
 *
 * @param raw - CLI/UI 传入的目标字符串，支持 `gotify:<accountId>` 或裸 accountId。
 * @returns 账号 ID；空目标返回 undefined，让宿主回退到默认账号。
 */
function normalizeGotifyMessagingTarget(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^gotify:/i, "").trim() || undefined;
}

const resolveGotifyDmPolicy =
  createScopedDmSecurityResolver<ResolvedGotifyAccount>({
    channelKey: "gotify",
    resolvePolicy: (account) => account.dmPolicy,
    resolveAllowFrom: (account) => account.allowFrom,
    defaultPolicy: "open",
    approveHint: "openclaw pairing approve gotify <code>",
    normalizeEntry: (raw) =>
      raw
        .replace(/^gotify:/i, "")
        .trim()
        .toLowerCase(),
  });

/**
 * Gotify 渠道插件定义。
 *
 * 该对象是 OpenClaw 识别渠道能力、配置 schema、出站适配器、入站 gateway 生命周期
 * 和安全策略的主入口。渠道注册名固定为 `gotify`，所有路由、sessionKey 和 metadata
 * 都以该 ID 作为命名空间。
 */
export const gotifyChannel: ChannelPlugin<ResolvedGotifyAccount> = {
  id: "gotify",
  meta,
  capabilities: {
    chatTypes: ["direct"],
    media: false,
    reactions: false,
    threads: false,
    polls: false,
    nativeCommands: false,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.gotify", "session.dmScope"] },
  setupWizard: gotifySetupWizard,
  setup: gotifySetupAdapter,
  configSchema: gotifyConfigSchema,
  config: {
    listAccountIds: (cfg: OpenClawConfig) => listGotifyAccountIds(cfg),
    resolveAccount: (cfg: OpenClawConfig, accountId?: string | null) =>
      resolveGotifyAccount(cfg, accountId),
    defaultAccountId: (cfg: OpenClawConfig) =>
      resolveDefaultGotifyAccountId(cfg),
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
        sectionKey: "gotify",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({
      cfg,
      accountId,
    }: {
      cfg: OpenClawConfig;
      accountId: string;
    }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: "gotify",
        accountId,
        clearBaseFields: ["serverUrl", "appToken", "clientToken"],
      }),
    isConfigured: (account: ResolvedGotifyAccount) => account.configured,
    unconfiguredReason: () => "channels.gotify missing serverUrl or appToken",
    describeAccount: (account: ResolvedGotifyAccount): ChannelAccountSnapshot =>
      describeGotifyAccountSnapshot(account),
    resolveAllowFrom: ({
      cfg,
      accountId,
    }: {
      cfg: OpenClawConfig;
      accountId?: string | null;
    }) => resolveGotifyAccount(cfg, accountId).allowFrom,
    formatAllowFrom: ({ allowFrom }: { allowFrom: Array<string | number> }) =>
      allowFrom
        .map((entry: string | number) => String(entry).trim())
        .filter(Boolean),
  },
  security: {
    resolveDmPolicy: resolveGotifyDmPolicy,
    collectWarnings: ({ account }: { account: ResolvedGotifyAccount }) => {
      const warnings: string[] = [];
      const dmPolicy = account.dmPolicy ?? "open";
      if (
        dmPolicy === "open" &&
        !(account.allowFrom ?? []).some(
          (entry: string) => String(entry).trim() === "*",
        )
      ) {
        warnings.push(
          `- Gotify[${account.accountId}]：dmPolicy="open" 时建议设置 channels.gotify.allowFrom=["*"]，或使用 dmPolicy="allowlist" 限制 appid/peerId。`,
        );
      }
      return warnings;
    },
  },
  groups: {
    resolveRequireMention: () => false,
  },
  threading: {
    resolveReplyToMode: () => "off",
  },
  messaging: {
    normalizeTarget: normalizeGotifyMessagingTarget,
    targetResolver: {
      looksLikeId: (raw: string) => Boolean(raw.trim()),
      hint: "<accountId>",
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
    buildChannelSummary: ({
      snapshot,
    }: {
      snapshot: ChannelAccountSnapshot;
    }) => ({
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
    buildAccountSnapshot: ({
      account,
    }: {
      account: ResolvedGotifyAccount;
    }) => ({
      ...describeGotifyAccountSnapshot(account),
      ...getAccountSnapshot(account.accountId),
    }),
  },
  gateway: {
    /**
     * 启动账号时根据配置决定是否建立 WebSocket 监听。
     *
     * @param ctx - OpenClaw gateway 为该账号构造的启动上下文。
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
        /*
         * 入站 stream 必须使用 Gotify Client token。账号仍然可能只配置 appToken 用于出站，
         * 因此这里不抛出进程级错误，只更新账号状态供 UI/CLI 展示。
         */
        const error =
          "inbound.enabled requires clientToken for WebSocket /stream";
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
      if (!account.inbound.allowedAppId) {
        const error =
          "inbound.enabled requires inbound.allowedAppId so the account subscribes to exactly one Gotify application";
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
      const processInbound = async (message: GotifyStreamEnvelope) => {
        await enqueueInbound(account.accountId, async () => {
          await dispatchInboundMessage(ctx, account, message);
        });
      };

      const bufferedMessages: GotifyStreamEnvelope[] = [];
      let buffering = true;
      const listener = createGotifyWsListener(account, {
        onMessage: async (message) => {
          if (buffering) {
            bufferedMessages.push(message);
            return;
          }
          await processInbound(message);
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
      /*
       * 同一账号可能因 reload/startAccount 再次启动。先停掉旧 listener，再记录新实例，
       * 避免多个 WebSocket 同时消费同一 Gotify stream。
       */
      listeners.get(account.accountId)?.stop();
      listeners.set(account.accountId, listener);
      await listener.start();

      try {
        const replay = await replayBacklogForAccount({
          account,
          dispatch: processInbound,
        });
        patchAccountSnapshot(account.accountId, {
          lastError:
            replay.replayed > 0
              ? `backlog replayed ${replay.replayed} messages up to ${replay.lastSeenMessageId}`
              : null,
        });
        ctx.setStatus({
          accountId: account.accountId,
          lastError:
            replay.replayed > 0
              ? `backlog replayed ${replay.replayed} messages up to ${replay.lastSeenMessageId}`
              : null,
        });
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : String(error);
        patchAccountSnapshot(account.accountId, {
          running: false,
          lastError: `backlog replay failed: ${errorMsg}`,
        });
        ctx.setStatus({
          accountId: account.accountId,
          running: false,
          lastError: `backlog replay failed: ${errorMsg}`,
        });
        listener.stop();
        listeners.delete(account.accountId);
        return;
      }

      while (bufferedMessages.length > 0) {
        const message = bufferedMessages.shift()!;
        await processInbound(message);
      }
      buffering = false;
      /*
       * gateway.startAccount 需要保持 Promise 挂起，让宿主管理该账号的生命周期。
       * stopAccount/cleanup 会 resolve 对应 stopSignal，使 startAccount 正常退出。
       */
      await new Promise<void>((resolve) => {
        stopSignals.get(account.accountId)?.();
        stopSignals.set(account.accountId, resolve);
      });
    },
    /**
     * 停止账号对应的 WebSocket listener 并更新运行态。
     *
     * @param ctx - OpenClaw gateway 为该账号构造的停止上下文。
     */
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
 *
 * @param ctx - OpenClaw gateway 上下文，包含配置、路由、reply 与 session runtime。
 * @param account - 当前 stream 所属的 Gotify 账号。
 * @param message - Gotify `/stream` 收到的原始消息。
 */
export async function dispatchInboundMessage(
  ctx: ChannelGatewayContext<ResolvedGotifyAccount>,
  account: ResolvedGotifyAccount,
  message: GotifyStreamEnvelope,
): Promise<void> {
  const cr = ctx.channelRuntime as GotifyChannelRuntime | undefined;
  if (!cr?.reply || !cr?.routing) {
    /*
     * channelRuntime 是 OpenClaw 宿主提供的核心能力。缺少 reply/routing 时，
     * 插件无法构造 transcript 或找到 agent，因此只记录状态并停止处理本条消息。
     */
    patchAccountSnapshot(account.accountId, {
      lastError: "channelRuntime does not expose reply/routing.",
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
    /*
     * 第二层自我回显过滤：即使 extras.openclaw 被外部清掉，只要 Gotify appid
     * 等于本账号最近一次出站得到的 Application ID，也视为本插件发出的消息。
     */
    return;
  }

  // ── 幂等去重（按 messageId，非 peer；成功派发后才写入缓存）────────────────
  const messageId = String(message.id ?? "");
  const dedupKey = messageId ? `${account.accountId}:${messageId}` : "";
  if (dedupKey && gotifyDedup.has(dedupKey)) {
    return;
  }

  const cfg = ctx.cfg as Record<string, unknown>;
  const peerId = resolveGotifyPeerId(message);
  const unified = mapGotifyStreamToUnified({
    accountId: account.accountId,
    peerId,
    message,
  });

  if (!unified.text.trim()) {
    // Gotify 允许空 message；空文本无法驱动 OpenClaw agent，直接跳过。
    return;
  }

  const configuredAllowedAppId = account.inbound.allowedAppId;
  if (configuredAllowedAppId > 0) {
    const incomingAppId =
      typeof message.appid === "number"
        ? message.appid
        : Number.parseInt(String(message.appid ?? ""), 10);
    if (!Number.isFinite(incomingAppId) || incomingAppId !== configuredAllowedAppId) {
      return;
    }
  }

  const dmAccess = await checkGotifyInboundAccess({
    cfg,
    account,
    peerId,
    appid: message.appid,
  });
  if (!dmAccess.allowed) {
    /*
     * DM 策略是企业接入的第一层边界。被阻断的消息不写 transcript，也不触发回复，
     * 只把阻断原因写入 lastError，方便 operator 调试 allowlist/pairing 配置。
     */
    patchAccountSnapshot(account.accountId, {
      lastError: dmAccess.reason
        ? `Blocked inbound (${dmAccess.reason})`
        : "Blocked inbound",
    });
    return;
  }

  const route = await cr.routing.resolveAgentRoute({
    cfg,
    channel: "gotify",
    accountId: account.accountId,
    peer: { kind: "direct", id: peerId },
  });
  const resolvedAgentId =
    typeof route?.agentId === "string" && route.agentId.trim()
      ? route.agentId
      : "main";
  /** 路由未返回 sessionKey 时按 dmScope 常见形式兜底，避免 transcript 无法写入 Control UI。 */
  const sessionKey =
    typeof route?.sessionKey === "string" && route.sessionKey.trim()
      ? route.sessionKey
      : `agent:${resolvedAgentId}:gotify:${account.accountId}:direct:${peerId}`;
  const lastRouteSessionKey =
    route?.lastRoutePolicy === "main" &&
    typeof route?.mainSessionKey === "string" &&
    route.mainSessionKey.trim()
      ? route.mainSessionKey
      : sessionKey;
  const messageText = unified.text.trim();
  const fromAddress = `gotify:${peerId}`;
  /** 对端地址，用于 lastRoute / OriginatingTo（对齐 Feishu DM：to 指向会话对端而非本账号）。 */
  const peerAddress = fromAddress;

  let resolvedAppName: string | undefined;
  if (
    message.appid !== undefined &&
    message.appid !== null &&
    account.clientToken
  ) {
    const appId =
      typeof message.appid === "number"
        ? message.appid
        : Number.parseInt(String(message.appid), 10);
    if (Number.isFinite(appId) && appId > 0) {
      /*
       * Gotify stream 只有 appid，没有应用名称。为让 Control UI 显示可读会话名，
       * 在有 clientToken 时按 appid 查询 Application API，并由 gotify-api 缓存结果。
       */
      resolvedAppName = await resolveApplicationName(account, appId);
    }
  }

  const conversationLabel = resolveGotifyConversationLabel(message, peerId, {
    accountId: account.accountId,
    appName: resolvedAppName,
  });
  const senderName = resolveGotifySenderName(message, peerId, resolvedAppName);
  const nativeDirectUserId =
    message.appid !== undefined && message.appid !== null
      ? String(message.appid)
      : undefined;
  const inboundContext = await cr.reply.finalizeInboundContext({
    Body: messageText,
    BodyForAgent: messageText,
    RawBody: messageText,
    CommandBody: messageText,
    From: fromAddress,
    To: peerAddress,
    SessionKey: sessionKey,
    AccountId: account.accountId,
    ChatType: "direct",
    ConversationLabel: conversationLabel,
    SenderId: peerId,
    SenderName: senderName,
    Provider: "gotify",
    Surface: "gotify",
    OriginatingChannel: "gotify",
    OriginatingTo: peerAddress,
    NativeDirectUserId: nativeDirectUserId,
    MessageSid: messageId || undefined,
    Timestamp: message.date
      ? Date.parse(message.date) || Date.now()
      : Date.now(),
    CommandAuthorized: true,
    gotifyAppId: message.appid,
    gotifyMetadata: unified.metadata,
    unifiedMessageId: unified.messageId,
  });

  const storePath =
    cr.session?.resolveStorePath && sessionKey
      ? cr.session.resolveStorePath(
          (cfg as { session?: { store?: string } }).session?.store,
          { agentId: resolvedAgentId },
        )
      : undefined;

  const onRecordError = (err: unknown) => {
    const errorMsg = err instanceof Error ? err.message : String(err);
    patchAccountSnapshot(account.accountId, {
      lastError: `recordInboundSession: ${errorMsg}`,
    });
  };

  const deliverReply = async (payload: { text: string }) => {
    /*
     * Agent 回复仍然通过 Gotify Application token 投递。extras.openclaw.outbound
     * 标记由 withOpenClawOutboundExtras 写入，确保回复进入 /stream 时不会再次触发 agent。
     */
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
    channel: "gotify" as const,
    to: peerAddress,
    accountId: account.accountId,
  };

  if (
    !cr.turn?.runAssembled &&
    (!cr.session?.recordInboundSession || !storePath || !sessionKey)
  ) {
    /*
     * 缺少 transcript 记录能力时仍继续调用 dispatchTranscriptTurn：
     * 新版宿主可能通过 turn.runAssembled 完成记录和派发；这里仅保留状态提示。
     */
    patchAccountSnapshot(account.accountId, {
      lastError: `Cannot record inbound transcript (missing session API or sessionKey=${sessionKey ?? "missing"})`,
    });
  }

  await dispatchTranscriptTurn({
    channelRuntime: cr as unknown as TranscriptChannelRuntime,
    cfg,
    channel: "gotify",
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
    /*
     * 只有成功派发并完成回复链路后才写入幂等缓存。
     * 这样短暂失败不会让消息在 60 秒内被永久跳过，便于重连或人工重试。
     */
    gotifyDedup.remember(dedupKey);
  }

  // 入站：在 Agent 回复投递成功后再删除用户消息，避免「先删后答」打断一轮
  await deleteConsumedGotifyMessage(account, message);

  const allowedAppId = account.inbound.allowedAppId;
  const seenMessageId = parsePositiveMessageId(message.id);
  if (allowedAppId > 0 && seenMessageId > 0) {
    await writeBacklogCursor(account.accountId, allowedAppId, seenMessageId);
  }

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
 *
 * @param account - 当前 Gotify 账号配置。
 * @returns true 表示消费成功后应删除 Gotify 服务端消息。
 */
function shouldDeleteAfterConsume(account: ResolvedGotifyAccount): boolean {
  return account.inbound.deleteAfterConsume !== false;
}

/**
 * 消费成功后从 Gotify 服务端删除消息（入站原消息或出站 Agent 回复）。
 * 删除失败仅记录 lastError，不影响已完成的派发/发送。
 *
 * @param account - 当前 Gotify 账号配置，必须具备 clientToken 才能删除。
 * @param message - 需要删除的 Gotify 消息或至少包含 id 的对象。
 */
async function deleteConsumedGotifyMessage(
  account: ResolvedGotifyAccount,
  message: GotifyStreamEnvelope,
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
  const messageId =
    typeof rawId === "number" ? rawId : Number.parseInt(String(rawId), 10);
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
