/**
 * @fileoverview openclaw-mqtt 插件入口 — ChannelPlugin + HTTP 状态路由。
 *
 * @module mqtt
 *
 * 按 OpenClaw 文档使用 defineChannelPluginEntry，注册 ChannelPlugin、HTTP 状态路由、注入 PluginRuntime。
 *
 * @see https://docs.openclaw.ai/plugins/sdk-channel-plugins
 * @see https://docs.openclaw.ai/plugins/sdk-entrypoints#definechannelpluginentry
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

import { getBrokerStats, getConnectedClients } from "./transport/server.js";
import { mqttPlugin } from "./runtime/mqtt-plugin.js";
import { getPendingAckStats } from "./transport/qos-handler.js";
import { getSessionStats } from "./routing/session-mapper.js";
import { setMqttRuntime } from "./runtime.js";
import { getMqttChannelConfig, getMqttPolicyMeta } from "./state/mqtt-state.js";

export { mqttPlugin } from "./runtime/mqtt-plugin.js";
export { resolveBrokerConfig } from "./config.js";
export type { ResolvedMqttAccount } from "./config.js";

export default defineChannelPluginEntry({
  id: "mqtt",
  name: "MQTT",
  description:
    "OpenClaw MQTT channel — embedded Aedes broker, multi-topic routing and explicit topic→agent bindings",
  plugin: mqttPlugin,
  setRuntime: setMqttRuntime,
  /**
   * 仅在 registrationMode === "full" 时注册 HTTP 路由（与官方 channel 示例中 webhook 写法一致）。
   *
   * @param api - OpenClaw 插件 API
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
  /** Graceful shutdown：停止 QoS handler 与 embedded Aedes broker。 */
  console.log("[openclaw-mqtt] Shutting down...");
  const { stopQosHandler } = await import("./transport/qos-handler.js");
  const { stopBroker } = await import("./transport/server.js");
  stopQosHandler();
  await stopBroker();
});
