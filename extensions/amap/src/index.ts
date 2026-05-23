/**
 * @partme.ai/openclaw-amap 插件入口
 *
 * 高德开放平台渠道 + 运营工具，公域 Agent-First 智能运营。
 */

import type { PluginApi } from "./types.js";
import { amapChannel } from "./channel.js";
import { createAmapConfigGetter } from "./config.js";
import { createAmapWebhookHandler } from "./inbound.js";
import { createAmapTools } from "./tools.js";
import { AMAP_WEBHOOK_PATH } from "./transport/server.js";

/**
 * 插件注册入口
 */
export default function register(api: PluginApi): void {
  api.registerChannel({ plugin: amapChannel });

  const getConfig = createAmapConfigGetter(api);

  const webhookHandler = createAmapWebhookHandler(getConfig, api);
  api.registerHttpRoute({
    path: AMAP_WEBHOOK_PATH,
    handler: webhookHandler,
  });

  if (typeof api.registerTool === "function") {
    const tools = createAmapTools(getConfig);
    for (const tool of tools) api.registerTool(tool);
  }

  console.log(`[amap] Plugin registered — channel amap + ${AMAP_WEBHOOK_PATH}`);
}
