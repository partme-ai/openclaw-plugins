/**
 * openclaw-web-mqtt 入口。
 * 使用 defineChannelPluginEntry 注册 channel，并在 full 模式暴露状态路由。
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { mqttWsChannel } from "./channel.js";
import { setWebMqttRuntime } from "./runtime.js";
import { buildWebMqttConfigSnapshot, resolveWebMqttConfig } from "./mqtt-config.js";
import { getWebMqttChannelConfig } from "./mqtt-state.js";
import { getSessionStats } from "./session-mapper.js";
import { getStats } from "./ws-server.js";

export { mqttWsChannel } from "./channel.js";

/**
 * channel plugin entry。
 */
export default defineChannelPluginEntry({
  id: "openclaw-web-mqtt",
  name: "Web MQTT",
  description: "OpenClaw Web MQTT channel plugin with enterprise-grade controls.",
  plugin: mqttWsChannel,
  setRuntime: setWebMqttRuntime,
  registerFull(api: OpenClawPluginApi) {
    api.registerHttpRoute({
      path: "/mqtt-ws/status",
      auth: "plugin",
      match: "prefix",
      handler: async (_req: IncomingMessage, res: ServerResponse) => {
        const runtimeConfig = resolveWebMqttConfig(((api.runtime as { config?: Record<string, unknown> })?.config ?? {}) as Record<string, unknown>);
        const activeConfig = getWebMqttChannelConfig() ?? runtimeConfig;
        const response = {
          ok: true,
          data: {
            stats: getStats(),
            sessions: getSessionStats(),
            config: buildWebMqttConfigSnapshot(activeConfig),
          },
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
      },
    });
  },
});
