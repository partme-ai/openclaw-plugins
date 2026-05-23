/**
 * @partme.ai/openclaw-rednode 插件入口。
 */

import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

import { xhsChannel } from "./channel.js";
import { createXhsConfigGetter } from "./config.js";
import { createXhsWebhookHandler } from "./inbound.js";
import { setRuntime } from "./runtime.js";
import { createXhsTools } from "./tools/tools.js";
import { XHS_WEBHOOK_PATH } from "./transport/server.js";
import type { PluginApi } from "./types.js";

export { xhsChannel } from "./channel.js";

export default defineChannelPluginEntry({
  id: "rednode",
  name: "Rednode",
  description: "小红书开放平台渠道与运营工具 — 公域 Agent-First 智能运营",
  plugin: xhsChannel as never,
  setRuntime,
  registerFull(api: OpenClawPluginApi) {
    const pluginApi = api as unknown as PluginApi;
    const getConfig = createXhsConfigGetter(pluginApi);

    api.registerHttpRoute({
      path: XHS_WEBHOOK_PATH,
      auth: "plugin",
      handler: createXhsWebhookHandler(getConfig, pluginApi),
    });

    if (typeof api.registerTool === "function") {
      for (const tool of createXhsTools(getConfig)) {
        api.registerTool(tool as never);
      }
    }

    console.log(`[rednode] Plugin registered — channel xhs + ${XHS_WEBHOOK_PATH}`);
  },
});
