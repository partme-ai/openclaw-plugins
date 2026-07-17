/**
 * web-mqtt channel 插件定义。
 * 负责账户状态、gateway 生命周期与 outbound 回包逻辑。
 */

import { parseDirectTarget, publishDirectText, publishOutboundText } from "./outbound.js";
import type { ChannelOutboundContext } from "openclaw/plugin-sdk/channel-contract";
import type {
  ChannelAccountSnapshot,
  ChannelGatewayContext,
  ChannelPlugin,
  OpenClawConfig,
} from "openclaw/plugin-sdk";
import {
  getStats,
  startWebMqttServer,
  stopWebMqttServer,
  trackInboundAccepted,
  trackInboundDropped,
  trackRoute,
} from "./transport/server.js";
import { resolveWebMqttConfig, validateWebMqttConfig } from "./config.js";
import { getWebMqttChannelConfig, setWebMqttChannelConfig } from "./state/mqtt-state.js";
import { processInbound } from "./inbound.js";
import { isWebMqttConfigured } from "./state/configured.js";

/**
 * 单账户场景的 accountId。
 */
export const DEFAULT_ACCOUNT_ID = "default";

type ResolvedWebMqttAccount = {
  accountId: typeof DEFAULT_ACCOUNT_ID;
  name: string;
  enabled: boolean;
  configured: boolean;
};

/**
 * 导出的 channel plugin。
 */
export const mqttWsChannel: ChannelPlugin<ResolvedWebMqttAccount> = {
  id: "mqtt-ws",
  meta: {
    id: "mqtt-ws",
    label: "MQTT over WebSocket",
    selectionLabel: "MQTT over WebSocket (Browser)",
    docsPath: "/channels/mqtt-ws",
    blurb: "MQTT over WebSocket bridge with enterprise-grade controls.",
    aliases: ["mqtt-ws", "web-mqtt"],
    order: 89,
  },
  capabilities: { chatTypes: ["direct"] as const },
  reload: { configPrefixes: ["channels.mqtt-ws"] },
  config: {
    listAccountIds: (cfg: Record<string, unknown>) =>
      isWebMqttConfigured(cfg as unknown as OpenClawConfig) ? [DEFAULT_ACCOUNT_ID] : [],
    resolveAccount: (cfg: Record<string, unknown>) => {
      const config = resolveWebMqttConfig(cfg);
      const configured = isWebMqttConfigured(cfg as unknown as OpenClawConfig);
      const section = ((cfg.channels as Record<string, unknown> | undefined)?.["mqtt-ws"] ?? {}) as {
        enabled?: boolean;
      };
      return {
        accountId: DEFAULT_ACCOUNT_ID,
        name: "MQTT over WebSocket",
        enabled: section.enabled !== false,
        configured,
      };
    },
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    isConfigured: (account: { configured: boolean }) => account.configured,
    unconfiguredReason: () => "channels.mqtt-ws requires explicit port and path configuration",
  },
  status: {
    buildAccountSnapshot: ({
      account,
      cfg,
      runtime,
    }: {
      account: ResolvedWebMqttAccount;
      cfg: OpenClawConfig;
      runtime?: ChannelAccountSnapshot;
    }) => {
      const config = resolveWebMqttConfig(cfg as unknown as Record<string, unknown>);
      const serviceStats = getStats();
      return {
        ...runtime,
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: account.configured,
        webhookPath: "/mqtt-ws/status",
        port: config.port,
        extra: serviceStats,
      };
    },
  },
  gateway: {
    /**
     * @description 启动 Web MQTT 服务并挂起至 abort。
     * @param root0.cfg - 完整网关配置（OpenClaw 2026.5+ ChannelGatewayContext）。
     * @param root0.abortSignal - 停止信号。
     */
    startAccount: async ({ cfg, abortSignal, log }: ChannelGatewayContext<ResolvedWebMqttAccount>) => {
      const config = resolveWebMqttConfig(cfg as unknown as Record<string, unknown>);
      const issues = validateWebMqttConfig(config);
      for (const issue of issues) {
        log?.warn(`[openclaw-web-mqtt] config warning: ${issue}`);
      }

      await startWebMqttServer(config, async (event) => {
        const result = await processInbound(event, config);
        if (result.accepted) {
          trackInboundAccepted();
          if (result.routeSource) trackRoute(result.routeSource);
        } else {
          trackInboundDropped(result.reason ?? "unknown_drop_reason");
        }
        return result;
      });
      setWebMqttChannelConfig(config);
      try {
        if (!abortSignal.aborted) {
          await new Promise<void>((resolve) => {
            abortSignal.addEventListener("abort", () => resolve(), { once: true });
          });
        }
      } finally {
        await stopWebMqttServer();
        setWebMqttChannelConfig(null);
      }
    },
  },
  outbound: {
    deliveryMode: "direct" as const,
    sendText: async (ctx: ChannelOutboundContext) => {
      const config = getWebMqttChannelConfig() ?? resolveWebMqttConfig({});
      const directTarget = parseDirectTarget(ctx.to);
      if (directTarget) {
        if (!ctx.deliveryQueueId) throw new Error("[openclaw-web-mqtt] Explicit direct delivery requires deliveryQueueId");
        await publishDirectText(directTarget, ctx.text);
        return { channel: "mqtt-ws", messageId: ctx.deliveryQueueId };
      }
      await publishOutboundText(ctx.to, ctx.text, config.topicPrefix);
      return { channel: "mqtt-ws", messageId: ctx.to };
    },
  },
};
