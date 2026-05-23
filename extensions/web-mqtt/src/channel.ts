/**
 * web-mqtt channel 插件定义。
 * 负责账户状态、gateway 生命周期与 outbound 回包逻辑。
 */

import { publishOutboundText } from "./outbound.js";
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
import { webMqttSetupAdapter, webMqttSetupWizard } from "./onboarding.js";

/**
 * 单账户场景的 accountId。
 */
export const DEFAULT_ACCOUNT_ID = "default";

/**
 * 导出的 channel plugin。
 */
export const mqttWsChannel = {
  id: "mqtt-ws",
  name: "MQTT over WebSocket",
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
  setupWizard: webMqttSetupWizard,
  setup: webMqttSetupAdapter,
  config: {
    listAccountIds: () => [DEFAULT_ACCOUNT_ID],
    resolveAccount: (cfg: Record<string, unknown>) => {
      const config = resolveWebMqttConfig(cfg);
      return {
        accountId: DEFAULT_ACCOUNT_ID,
        name: "MQTT over WebSocket",
        enabled: true,
        configured: Boolean(config.port && config.path),
      };
    },
  },
  status: {
    buildAccountSnapshot: (cfg: Record<string, unknown>) => {
      const config = resolveWebMqttConfig(cfg);
      const serviceStats = getStats();
      return {
        accountId: DEFAULT_ACCOUNT_ID,
        name: "MQTT over WebSocket",
        enabled: true,
        configured: true,
        webhookPath: "/mqtt-ws/status",
        port: config.port,
        extra: serviceStats,
      };
    },
  },
  gateway: {
    startAccount: async ({ runtime, abortSignal }: { runtime: { config: Record<string, unknown> }; abortSignal: AbortSignal }) => {
      const config = resolveWebMqttConfig(runtime.config);
      setWebMqttChannelConfig(config);
      const issues = validateWebMqttConfig(config);
      for (const issue of issues) {
        console.warn(`[openclaw-web-mqtt] config warning: ${issue}`);
      }

      await startWebMqttServer(config, async (event) => {
        try {
          const result = await processInbound(event, config);
          if (result.accepted) {
            trackInboundAccepted();
            if (result.routeSource) trackRoute(result.routeSource);
          } else {
            trackInboundDropped(result.reason ?? "unknown_drop_reason");
          }
        } catch (error) {
          trackInboundDropped(`inbound_dispatch_error:${String(error)}`);
        }
      });

      await new Promise<void>((resolve) => {
        const onAbort = (): void => resolve();
        abortSignal.addEventListener("abort", onAbort, { once: true });
      });
      await stopWebMqttServer();
    },
  },
  outbound: {
    deliveryMode: "direct" as const,
    sendText: async (sessionKey: string, text: string): Promise<void> => {
      const config = getWebMqttChannelConfig() ?? resolveWebMqttConfig({});
      await publishOutboundText(sessionKey, text, config.topicPrefix);
    },
  },
};
