/**
 * @partme.ai/openclaw-amap 插件入口
 *
 * 高德开放平台渠道 + 运营工具，公域 Agent-First 智能运营。
 */

import {
  defineChannelPluginEntry,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";

import { amapChannel } from "./channel.js";
import { createAmapConfigGetter } from "./config.js";
import { createAmapWebhookHandler } from "./inbound.js";
import { setAmapRuntime } from "./runtime.js";
import { createAmapTools } from "./tools/tools.js";
import { AMAP_WEBHOOK_PATH } from "./transport/server.js";

export { amapChannel } from "./channel.js";

export default defineChannelPluginEntry({
  id: "amap",
  name: "高德",
  description: "高德开放平台渠道与运营工具 — 公域 Agent-First 智能运营",
  plugin: amapChannel as never,
  setRuntime: setAmapRuntime,
  registerFull(api: OpenClawPluginApi) {
    const getConfig = createAmapConfigGetter(api as never);

    const webhookHandler = createAmapWebhookHandler(getConfig, api as never);
    api.registerHttpRoute({
      path: AMAP_WEBHOOK_PATH,
      auth: "plugin",
      handler: webhookHandler,
    });

    if (typeof api.registerTool === "function") {
      const tools = createAmapTools(getConfig);
      for (const tool of tools) api.registerTool(tool as never);
    }

    console.log(`[amap] Plugin registered — channel amap + ${AMAP_WEBHOOK_PATH}`);
  },
});
