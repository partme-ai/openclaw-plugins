/**
 * openclaw-mqtt 插件入口：按 OpenClaw 文档使用 defineChannelPluginEntry，注册 ChannelPlugin、HTTP 状态路由、注入 PluginRuntime。
 *
 * @see https://docs.openclaw.ai/plugins/sdk-channel-plugins
 * @see https://docs.openclaw.ai/plugins/sdk-entrypoints#definechannelpluginentry
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

import { getBrokerStats, getConnectedClients } from "./broker.js";
import { mqttPlugin } from "./mqtt-plugin.js";
import { getPendingAckStats } from "./qos-handler.js";
import { getSessionStats } from "./session-mapper.js";
import { setMqttRuntime } from "./runtime.js";
import { getMqttChannelConfig, getMqttPolicyMeta } from "./mqtt-state.js";

export { mqttPlugin } from "./mqtt-plugin.js";
export { resolveBrokerConfig } from "./config.js";
export type { ResolvedMqttAccount } from "./config.js";

export default defineChannelPluginEntry({
  id: "openclaw-mqtt",
  name: "MQTT",
  description:
    "OpenClaw MQTT channel — embedded Aedes broker, multi-topic routing and explicit topic→agent bindings",
  plugin: mqttPlugin,
  setRuntime: setMqttRuntime,
  /**
   * 仅在 registrationMode === "full" 时注册 HTTP 路由（与官方 channel 示例中 webhook 写法一致）。
   */
  registerFull(api: OpenClawPluginApi) {
    api.registerHttpRoute({
      path: "/mqtt/status",
      handler: async (_req: IncomingMessage, res: ServerResponse) => {
        const brokerStats = getBrokerStats();
        const sessionStats = getSessionStats();
        const qosStats = getPendingAckStats();
        const clients = getConnectedClients();
        const policyMeta = getMqttPolicyMeta();
        const config = getMqttChannelConfig();

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              broker: brokerStats,
              sessions: sessionStats,
              qos: qosStats,
              clients,
              config,
              policy: {
                ...policyMeta,
                summary: config
                  ? {
                      openClawDmScope: policyMeta.openClawDmScope,
                      qos0MailboxSoftLimit: config.qos0.mailboxSoftLimit,
                      maxPayloadBytes: config.limits.maxPayloadBytes,
                      auditEnabled: config.audit.enabled,
                    }
                  : null,
              },
            },
          }),
        );
      },
      auth: "plugin",
      match: "prefix",
    });

    console.log("[openclaw-mqtt] Plugin registered — MQTT channel ready");
    console.log("[openclaw-mqtt] Endpoints: /mqtt/status — broker status & connected clients");
  },
});

process.on("SIGTERM", async () => {
  console.log("[openclaw-mqtt] Shutting down...");
  const { stopQosHandler } = await import("./qos-handler.js");
  const { stopBroker } = await import("./broker.js");
  stopQosHandler();
  await stopBroker();
});
