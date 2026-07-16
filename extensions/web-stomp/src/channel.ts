/**
 * @fileoverview STOMP 1.2 over WebSocket 服务到 OpenClaw Channel 的生命周期适配层。
 *
 * Channel 启动时创建 WS/WSS STOMP Server 并把 SEND 帧路由到 Agent，停止时随 AbortSignal
 * 清理连接；Agent 回复发布到该会话专属 Topic，没有订阅者接收时明确失败。账户配置、状态
 * 和探针与协议帧处理分离，保持 OpenClaw 2026.7.1 Channel 契约清晰。
 */
import type {
  ChannelAccountSnapshot,
  ChannelGatewayContext,
  ChannelPlugin,
  OpenClawConfig,
} from "openclaw/plugin-sdk";
import { deleteAccountFromConfigSection, setAccountEnabledInConfigSection } from "openclaw/plugin-sdk/core";
import type { ChannelOutboundContext } from "openclaw/plugin-sdk/channel-contract";
import { sanitizeForPlainText } from "openclaw/plugin-sdk/outbound-runtime";

import {
  describeStompAccount,
  listStompAccountIds,
  resolveStompAccount,
  resolveStompWsConfig,
  WEB_STOMP_ACCOUNT_ID,
} from "./config.js";
import { dispatchInboundStomp } from "./inbound.js";
import { stompWsSetupAdapter, stompWsSetupWizard } from "./onboarding.js";
import { buildSessionDestination } from "./routing/destination-router.js";
import { getStompServerStats, publishToDestination, startStompServer, stopStompServer } from "./transport/server.js";
import type { ResolvedWebStompAccount } from "./types.js";

const meta = {
  id: "stomp",
  label: "STOMP over WebSocket",
  selectionLabel: "STOMP over WebSocket (plugin)",
  docsPath: "/channels/stomp",
  docsLabel: "stomp",
  blurb: "STOMP 1.2 over WebSocket/WSS with bounded enterprise delivery controls.",
  aliases: ["stomp", "web-stomp"],
  order: 91,
  quickstartAllowFrom: false,
};

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

function normalizeTarget(raw: string): string | undefined {
  const value = raw.trim().replace(/^(web-stomp|stomp):/i, "").trim();
  return value || undefined;
}

async function monitor(ctx: ChannelGatewayContext<ResolvedWebStompAccount>): Promise<void> {
  const config = resolveStompWsConfig(ctx.cfg as unknown as Record<string, unknown>);
  try {
    await startStompServer(config, (message) => dispatchInboundStomp(message));
    ctx.setStatus({
      accountId: ctx.account.accountId,
      configured: true,
      running: true,
      port: config.wsPort,
      webhookPath: "/stomp/status",
      lastStartAt: Date.now(),
    } as ChannelAccountSnapshot);
    await waitForAbort(ctx.abortSignal);
  } catch (error) {
    ctx.setStatus({ accountId: ctx.account.accountId, running: false, lastError: String(error) } as ChannelAccountSnapshot);
    throw error;
  } finally {
    await stopStompServer();
    ctx.setStatus({ accountId: ctx.account.accountId, running: false, lastStopAt: Date.now() } as ChannelAccountSnapshot);
  }
}

export const stompChannel: ChannelPlugin<ResolvedWebStompAccount> = {
  id: "stomp",
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
  reload: { configPrefixes: ["channels.stomp"] },
  setupWizard: stompWsSetupWizard,
  setup: stompWsSetupAdapter,
  configSchema: { schema: { type: "object", additionalProperties: true, properties: {} } },
  config: {
    listAccountIds: (cfg: OpenClawConfig) => listStompAccountIds(cfg),
    defaultAccountId: () => WEB_STOMP_ACCOUNT_ID,
    resolveAccount: (cfg: OpenClawConfig) => resolveStompAccount(cfg),
    setAccountEnabled: ({ cfg, accountId, enabled }) => setAccountEnabledInConfigSection({
      cfg,
      sectionKey: "stomp",
      accountId,
      enabled,
      allowTopLevel: true,
    }),
    deleteAccount: ({ cfg, accountId }) => deleteAccountFromConfigSection({
      cfg,
      sectionKey: "stomp",
      accountId,
      clearBaseFields: [],
    }),
    isConfigured: (account) => account.configured,
    unconfiguredReason: () => "channels.stomp is missing",
    describeAccount: (account, cfg) => describeStompAccount(account, resolveStompWsConfig(cfg as unknown as Record<string, unknown>)),
  },
  groups: { resolveRequireMention: () => false },
  threading: { resolveReplyToMode: () => "off" },
  messaging: {
    normalizeTarget,
    targetResolver: { looksLikeId: (raw) => Boolean(raw.trim()), hint: "<STOMP topic or session key>" },
  },
  outbound: {
    deliveryMode: "direct",
    sanitizeText: ({ text }) => sanitizeForPlainText(text),
    sendText: async (ctx: ChannelOutboundContext) => {
      const destination = ctx.to.startsWith("/topic/") ? ctx.to : buildSessionDestination(ctx.to);
      const delivered = publishToDestination(destination, ctx.text);
      if (delivered < 1) {
        throw new Error(`No Web STOMP subscriber accepted destination: ${destination}`);
      }
      return { channel: "stomp", messageId: `${destination}:${delivered}` };
    },
  },
  status: {
    defaultRuntime: {
      accountId: WEB_STOMP_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      webhookPath: snapshot.webhookPath ?? null,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
    }),
    probeAccount: async () => ({ ok: getStompServerStats().running }),
    buildAccountSnapshot: ({ account, runtime, cfg }) => {
      const config = resolveStompWsConfig(cfg as unknown as Record<string, unknown>);
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: account.configured,
        running: runtime?.running ?? getStompServerStats().running,
        port: config.wsPort,
        webhookPath: "/stomp/status",
        lastStartAt: runtime?.lastStartAt ?? null,
        lastStopAt: runtime?.lastStopAt ?? null,
        lastError: runtime?.lastError ?? null,
      };
    },
  },
  gateway: {
    startAccount: monitor,
    stopAccount: async (ctx) => {
      await stopStompServer();
      ctx.setStatus({ accountId: ctx.account.accountId, running: false, lastStopAt: Date.now() });
    },
  },
};
