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
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

import { getBrokerStats, getConnectedClients } from "./transport/server.js";
import { mqttPlugin } from "./runtime/mqtt-plugin.js";
import { getSessionStats } from "./routing/session-mapper.js";
import { setMqttRuntime } from "./runtime.js";
import { getMqttChannelConfig, getMqttPolicyMeta } from "./state/mqtt-state.js";
import type { MqttBrokerConfig } from "./types.js";

export { mqttPlugin } from "./runtime/mqtt-plugin.js";
export { resolveBrokerConfig } from "./config.js";
export type { ResolvedMqttAccount } from "./config.js";

/**
 * 生成可由状态接口公开的 MQTT 配置摘要。
 *
 * 返回值刻意排除用户名密码、证书路径、遗嘱内容等敏感或业务字段，仅保留排障所需的监听、
 * 容量和策略元数据；新增配置字段时不得直接展开整个配置对象。
 */
export function sanitizeMqttConfig(config: MqttBrokerConfig | null): Record<string, unknown> | null {
  if (!config) return null;
  return {
    host: config.host,
    port: config.port,
    maxConnections: config.maxConnections,
    auth: {
      enabled: config.auth.enabled,
      allowAnonymous: config.auth.allowAnonymous,
      userCount: config.auth.users.length,
    },
    tls: {
      enabled: config.tls.enabled,
      port: config.tls.port,
      requestCert: config.tls.requestCert,
      rejectUnauthorized: config.tls.rejectUnauthorized,
    },
    persistence: {
      enabled: config.persistence.enabled,
      backend: config.persistence.backend,
    },
    limits: { ...config.limits },
  };
}

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
        const clients = getConnectedClients();
        const policyMeta = getMqttPolicyMeta();
        const config = getMqttChannelConfig();
        const safeConfig = sanitizeMqttConfig(config);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              broker: brokerStats,
              sessions: sessionStats,
              qos: { handledBy: "aedes", levels: [0, 1, 2] },
              clients,
              config: safeConfig,
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
      match: "exact",
    });
  },
});
