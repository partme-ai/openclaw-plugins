/**
 * @partme.ai/openclaw-meituan 插件入口
 */

import {
  defineChannelPluginEntry,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";

import { meituanChannel } from "./channel.js";
import { createMeituanConfigGetter } from "./config.js";
import { createMeituanWebhookHandler } from "./inbound.js";
import { setMeituanRuntime } from "./runtime.js";
import { createMeituanTools } from "./tools/tools.js";
import { MEITUAN_WEBHOOK_PATH } from "./transport/server.js";
import type { PluginApi } from "./types.js";

export { meituanChannel } from "./channel.js";

function log(api: PluginApi, level: "info" | "warn" | "error", msg: string, ...args: unknown[]): void {
  const fn = api.logger?.[level];
  if (typeof fn === "function") fn(msg, ...args);
  else if (level === "info") console.log(msg, ...args);
  else if (level === "warn") console.warn(msg, ...args);
  else console.error(msg, ...args);
}

export default defineChannelPluginEntry({
  id: "meituan",
  name: "美团",
  description: "美团开放平台渠道与运营工具 - 公域 Agent-First 智能运营",
  plugin: meituanChannel as never,
  setRuntime: setMeituanRuntime,
  registerFull(api: OpenClawPluginApi) {
    const pluginApi = api as never as PluginApi;
    const getConfig = createMeituanConfigGetter(pluginApi);

    const webhookHandler = createMeituanWebhookHandler(getConfig, pluginApi, pluginApi.logger);
    api.registerHttpRoute({
      path: MEITUAN_WEBHOOK_PATH,
      auth: "plugin",
      handler: webhookHandler,
    });

    if (typeof api.registerTool === "function") {
      const tools = createMeituanTools(getConfig);
      for (const tool of tools) api.registerTool(tool as never);
    }

    log(pluginApi, "info", `[meituan] Plugin registered — channel meituan + ${MEITUAN_WEBHOOK_PATH}`);
  },
});
