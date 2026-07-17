/**
 * @fileoverview 原生 STOMP 1.2 TCP/TLS 服务到 OpenClaw Channel 的生命周期适配层。
 *
 * Channel 启动时创建内嵌 Server 并把 SEND 帧路由到 Agent，停止时随 AbortSignal 关闭全部
 * 连接；Agent 出站文本按 session/topic 目标发布，若没有订阅者接收则明确失败，不伪造成功。
 * 账户状态和探针只读取 transport 快照，不直接管理协议帧。
 */
import type { ChannelAccountSnapshot, ChannelGatewayContext, ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk";
import { deleteAccountFromConfigSection, setAccountEnabledInConfigSection } from "openclaw/plugin-sdk/core";
import type { ChannelOutboundContext } from "openclaw/plugin-sdk/channel-contract";
import { sanitizeForPlainText } from "openclaw/plugin-sdk/outbound-runtime";

import {
  describeStompTcpAccount,
  listStompTcpAccountIds,
  resolveStompTcpAccount,
  resolveStompTcpConfig,
  STOMP_TCP_ACCOUNT_ID,
} from "./config.js";
import { dispatchInboundMessage } from "./inbound.js";
import { stompTcpSetupAdapter, stompTcpSetupWizard } from "./onboarding.js";
import { redactStompTcpError } from "./shared/redact.js";
import { getStatusSnapshot, publishToDestination, startStompTcpServer, stopStompTcpServer } from "./transport/server.js";
import type { ResolvedStompTcpAccount } from "./types.js";

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

function normalizeTarget(raw: string): string | undefined {
  const value = raw.trim().replace(/^stomp-tcp:/i, "").trim();
  return value || undefined;
}

async function monitor(ctx: ChannelGatewayContext<ResolvedStompTcpAccount>): Promise<void> {
  const config = resolveStompTcpConfig(ctx.cfg as unknown as Record<string, unknown>);
  try {
    await startStompTcpServer(config, dispatchInboundMessage, ctx.log);
    ctx.setStatus({
      accountId: ctx.account.accountId,
      configured: true,
      running: true,
      port: config.port || config.tlsPort,
      webhookPath: "/stomp-tcp/status",
      lastStartAt: Date.now(),
    } as ChannelAccountSnapshot);
    await waitForAbort(ctx.abortSignal);
  } catch (error) {
    ctx.setStatus({ accountId: ctx.account.accountId, running: false, lastError: redactStompTcpError(error) } as ChannelAccountSnapshot);
    throw error;
  } finally {
    await stopStompTcpServer();
    ctx.setStatus({ accountId: ctx.account.accountId, running: false, lastStopAt: Date.now() } as ChannelAccountSnapshot);
  }
}

/** OpenClaw 2026.7.1 使用的 STOMP TCP/TLS Channel 契约。 */
export const stompTcpChannel: ChannelPlugin<ResolvedStompTcpAccount> = {
  id: "stomp-tcp",
  meta: {
    id: "stomp-tcp",
    label: "STOMP TCP",
    selectionLabel: "STOMP 1.2 over TCP/TLS",
    docsPath: "/channels/stomp-tcp",
    docsLabel: "stomp-tcp",
    blurb: "Native STOMP 1.2 TCP/TLS channel with bounded in-memory delivery controls.",
    aliases: ["stomp-tcp"],
    order: 92,
    quickstartAllowFrom: false,
  },
  capabilities: {
    chatTypes: ["direct"],
    media: false,
    reactions: false,
    threads: false,
    polls: false,
    nativeCommands: false,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.stomp-tcp"] },
  setupWizard: stompTcpSetupWizard,
  setup: stompTcpSetupAdapter,
  configSchema: { schema: { type: "object", additionalProperties: true, properties: {} } },
  config: {
    listAccountIds: (cfg: OpenClawConfig) => listStompTcpAccountIds(cfg),
    defaultAccountId: () => STOMP_TCP_ACCOUNT_ID,
    resolveAccount: (cfg: OpenClawConfig) => resolveStompTcpAccount(cfg),
    setAccountEnabled: ({ cfg, accountId, enabled }) => setAccountEnabledInConfigSection({
      cfg,
      sectionKey: "stomp-tcp",
      accountId,
      enabled,
      allowTopLevel: true,
    }),
    deleteAccount: ({ cfg, accountId }) => deleteAccountFromConfigSection({
      cfg,
      sectionKey: "stomp-tcp",
      accountId,
      clearBaseFields: [],
    }),
    isConfigured: (account) => account.configured,
    unconfiguredReason: () => "channels.stomp-tcp is missing",
    describeAccount: (account, cfg) => describeStompTcpAccount(account, resolveStompTcpConfig(cfg as unknown as Record<string, unknown>)),
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
      const destination = ctx.to.startsWith("/topic/") ? ctx.to : `/topic/session.${ctx.to}`;
      const delivered = publishToDestination(destination, ctx.text);
      if (delivered < 1) {
        throw new Error(`No STOMP subscriber accepted outbound destination: ${destination}`);
      }
      return { channel: "stomp-tcp", messageId: `${destination}:${delivered}` };
    },
  },
  status: {
    defaultRuntime: { accountId: STOMP_TCP_ACCOUNT_ID, running: false, lastStartAt: null, lastStopAt: null, lastError: null },
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      webhookPath: snapshot.webhookPath ?? null,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
    }),
    probeAccount: async () => ({ ok: getStatusSnapshot().running }),
    buildAccountSnapshot: ({ account, runtime, cfg }) => {
      const config = resolveStompTcpConfig(cfg as unknown as Record<string, unknown>);
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: account.configured,
        running: runtime?.running ?? getStatusSnapshot().running,
        port: config.port || config.tlsPort,
        webhookPath: "/stomp-tcp/status",
        lastStartAt: runtime?.lastStartAt ?? null,
        lastStopAt: runtime?.lastStopAt ?? null,
        lastError: runtime?.lastError ?? null,
      };
    },
  },
  gateway: {
    startAccount: monitor,
    stopAccount: async (ctx) => {
      await stopStompTcpServer();
      ctx.setStatus({ accountId: ctx.account.accountId, running: false, lastStopAt: Date.now() });
    },
  },
};
