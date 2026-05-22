/**
 * OpenClaw MQTT 渠道定义。
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
} from "openclaw/plugin-sdk";

import { monitorMqttBroker } from "./transport/gateway-mqtt.js";
import { mqttOutbound } from "./outbound.js";
import { getBrokerStats } from "./transport/server.js";
import {
  DEFAULT_MQTT_ACCOUNT_ID,
  describeMqttAccountSnapshot,
  listMqttAccountIds,
  resolveBrokerConfig,
  resolveDefaultMqttAccountId,
  resolveMqttAccount,
  type ResolvedMqttAccount,
} from "./config.js";
import { mqttSetupAdapter, mqttSetupWizard } from "./onboarding.js";

const meta = {
  id: "mqtt",
  label: "MQTT",
  selectionLabel: "MQTT (plugin)",
  docsPath: "/channels/mqtt",
  docsLabel: "mqtt",
  blurb: "MQTT protocol bridge for IoT and device integration via embedded Aedes broker.",
  aliases: ["mqtt"],
  order: 90,
  quickstartAllowFrom: false,
};

function normalizeMqttMessagingTarget(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^mqtt:/i, "").trim() || undefined;
}

/**
 * MQTT 渠道插件（单账号 default；配置位于 `channels.mqtt`）。
 */
export const mqttChannel: ChannelPlugin<ResolvedMqttAccount> = {
  id: "mqtt",
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
  reload: { configPrefixes: ["channels.mqtt"] },
  setupWizard: mqttSetupWizard,
  setup: mqttSetupAdapter,
  configSchema: {
    schema: {
      type: "object",
      additionalProperties: true,
      properties: {},
    },
  },
  config: {
    listAccountIds: (cfg: OpenClawConfig) => listMqttAccountIds(cfg),
    resolveAccount: (cfg: OpenClawConfig, accountId?: string | null) => resolveMqttAccount(cfg, accountId),
    defaultAccountId: (cfg: OpenClawConfig) => resolveDefaultMqttAccountId(cfg),
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
        sectionKey: "mqtt",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }: { cfg: OpenClawConfig; accountId: string }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: "mqtt",
        accountId,
        clearBaseFields: [],
      }),
    isConfigured: (account: ResolvedMqttAccount) => account.configured,
    unconfiguredReason: (_account: ResolvedMqttAccount, _cfg: OpenClawConfig) => "channels.mqtt missing or empty",
    describeAccount: (account: ResolvedMqttAccount, cfg: OpenClawConfig): ChannelAccountSnapshot => {
      const port = resolveBrokerConfig(cfg as unknown as Record<string, unknown>).port;
      return describeMqttAccountSnapshot(account, port);
    },
  },
  groups: {
    resolveRequireMention: () => false,
  },
  threading: {
    resolveReplyToMode: () => "off",
  },
  messaging: {
    normalizeTarget: normalizeMqttMessagingTarget,
    targetResolver: {
      looksLikeId: (raw: string) => Boolean(raw.trim()),
      hint: "<sessionKey>",
    },
  },
  outbound: {
    ...mqttOutbound,
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_MQTT_ACCOUNT_ID,
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
      account: ResolvedMqttAccount;
      runtime: { running?: boolean; lastStartAt?: number | null; lastStopAt?: number | null; lastError?: string | null; lastInboundAt?: number | null; lastOutboundAt?: number | null } | null;
      cfg: OpenClawConfig;
    }) => {
      const stats = getBrokerStats();
      const port = resolveBrokerConfig(cfg as unknown as Record<string, unknown>).port;
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: account.configured,
        webhookPath: "/mqtt/status",
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
    startAccount: monitorMqttBroker,
    stopAccount: async (ctx: ChannelGatewayContext<ResolvedMqttAccount>) => {
      ctx.setStatus({
        accountId: ctx.account.accountId,
        running: false,
        lastStopAt: Date.now(),
      });
    },
  },
};