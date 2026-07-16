/**
 * openclaw-web-mqtt 入口。
 * 使用 defineChannelPluginEntry 注册 channel，并在 full 模式暴露状态路由。
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { mqttWsChannel } from "./channel.js";
import { setWebMqttRuntime } from "./runtime.js";
import { buildWebMqttConfigSnapshot, resolveWebMqttConfig } from "./config.js";
import { getWebMqttChannelConfig } from "./state/mqtt-state.js";
import { getSessionStats } from "./routing/session-mapper.js";
import { getStats } from "./transport/server.js";

export { mqttWsChannel } from "./channel.js";

/**
 * channel plugin entry。
 */
const pluginEntry = {
  id: "web-mqtt",
  name: "OpenClaw Web MQTT",
  description: "OpenClaw Web MQTT channel plugin with enterprise-grade controls.",
  configSchema: {
    schema: { type: "object", additionalProperties: false, properties: {} },
    runtime: {
      safeParse(value: unknown) {
        return { success: true as const, data: value };
      },
    },
  },
  register(api: OpenClawPluginApi) {
    if (api.registrationMode === "cli-metadata") return;
    if (api.registrationMode !== "tool-discovery") {
      api.registerChannel({ plugin: mqttWsChannel });
      setWebMqttRuntime(api.runtime);
      if (api.registrationMode !== "full") return;
    }
    api.registerHttpRoute({
      path: "/mqtt-ws/status",
      auth: "plugin",
      match: "exact",
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
  channelPlugin: mqttWsChannel,
  setChannelRuntime: setWebMqttRuntime,
};

export default pluginEntry;
