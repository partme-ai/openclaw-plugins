/**
 * @module web-socket/channel
 *
 * OpenClaw WebSocket 渠道定义。
 */

import type {
  ChannelAccountSnapshot,
  ChannelGatewayContext,
  ChannelPlugin,
  OpenClawConfig,
} from "openclaw/plugin-sdk";
import {
  deleteAccountFromConfigSection,
  setAccountEnabledInConfigSection,
} from "openclaw/plugin-sdk/core";

import {
  DEFAULT_WEBSOCKET_ACCOUNT_ID,
  describeWebsocketAccountSnapshot,
  listWebsocketAccountIds,
  resolveDefaultWebsocketAccountId,
  resolveWebsocketAccount,
  resolveWebsocketConfig,
  type ResolvedWebsocketAccount,
} from "./config.js";
import { webSocketSetupAdapter, webSocketSetupWizard } from "./onboarding.js";
import { webSocketOutbound } from "./outbound.js";
import { getConnectedClients, getServerStats } from "./transport/server.js";
import { monitorWebSocketChannel } from "./transport/gateway-ws.js";

const meta = {
  id: "web-socket",
  label: "WebSocket",
  selectionLabel: "WebSocket (plugin)",
  docsPath: "/channels/web-socket",
  docsLabel: "web-socket",
  blurb: "Native WebSocket channel with JSON message frames via embedded ws server.",
  aliases: ["web-socket", "websocket", "ws"],
  order: 91,
  quickstartAllowFrom: false,
};

function normalizeWebsocketMessagingTarget(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^(web-socket|websocket):/i, "").trim() || undefined;
}

/**
 * WebSocket 渠道插件（配置位于 `channels.web-socket`）。
 */
export const webSocketChannel: ChannelPlugin<ResolvedWebsocketAccount> = {
  id: "web-socket",
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
  reload: { configPrefixes: ["channels.web-socket"] },
  setupWizard: webSocketSetupWizard,
  setup: webSocketSetupAdapter,
  configSchema: {
    schema: {
      type: "object",
      additionalProperties: true,
      properties: {},
    },
  },
  config: {
    listAccountIds: (cfg: OpenClawConfig) => listWebsocketAccountIds(cfg),
    resolveAccount: (cfg: OpenClawConfig, accountId?: string | null) =>
      resolveWebsocketAccount(cfg, accountId),
    defaultAccountId: (cfg: OpenClawConfig) => resolveDefaultWebsocketAccountId(cfg),
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
        sectionKey: "web-socket",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }: { cfg: OpenClawConfig; accountId: string }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: "web-socket",
        accountId,
        clearBaseFields: [],
      }),
    isConfigured: (account: ResolvedWebsocketAccount) => account.configured,
    unconfiguredReason: () => "channels.web-socket missing or empty",
    describeAccount: (account: ResolvedWebsocketAccount, cfg: OpenClawConfig): ChannelAccountSnapshot => {
      const port = resolveWebsocketConfig(cfg as unknown as Record<string, unknown>).server.wsPort;
      return describeWebsocketAccountSnapshot(account, port);
    },
  },
  groups: {
    resolveRequireMention: () => false,
  },
  threading: {
    resolveReplyToMode: () => "off",
  },
  messaging: {
    normalizeTarget: normalizeWebsocketMessagingTarget,
    targetResolver: {
      looksLikeId: (raw: string) => Boolean(raw.trim()),
      hint: "<sessionKey>",
    },
  },
  outbound: {
    ...webSocketOutbound,
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_WEBSOCKET_ACCOUNT_ID,
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
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async () => ({ ok: true }),
    buildAccountSnapshot: ({
      account,
      runtime,
      cfg,
    }: {
      account: ResolvedWebsocketAccount;
      runtime?: ChannelAccountSnapshot;
      cfg: OpenClawConfig;
    }) => {
      const stats = getServerStats();
      const port = resolveWebsocketConfig(cfg as unknown as Record<string, unknown>).server.wsPort;
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: account.configured,
        webhookPath: "/web-socket/status",
        port,
        running: runtime?.running ?? stats.running,
        lastStartAt: runtime?.lastStartAt ?? null,
        lastStopAt: runtime?.lastStopAt ?? null,
        lastError: runtime?.lastError ?? null,
        lastInboundAt: runtime?.lastInboundAt ?? null,
        lastOutboundAt: runtime?.lastOutboundAt ?? null,
      };
    },
  },
  gateway: {
    startAccount: monitorWebSocketChannel,
    stopAccount: async (ctx: ChannelGatewayContext<ResolvedWebsocketAccount>) => {
      ctx.setStatus({
        accountId: ctx.account.accountId,
        running: false,
        lastStopAt: Date.now(),
      });
    },
  },
};
