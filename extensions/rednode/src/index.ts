/**
 * @partme.ai/openclaw-rednode 插件入口
 */

import type { PluginApi } from "./types.js";
import { xhsChannel } from "./channel.js";
import { createXhsConfigGetter } from "./config.js";
import { createXhsWebhookHandler } from "./inbound.js";
import { createXhsTools } from "./tools.js";
import { XHS_WEBHOOK_PATH } from "./transport/server.js";

/**
 * 插件注册入口
 */
export default function register(api: PluginApi): void {
  api.registerChannel({ plugin: xhsChannel });

  const getConfig = createXhsConfigGetter(api);

  const webhookHandler = createXhsWebhookHandler(getConfig, (params) => {
    const publish = api.runtime?.channel?.publishInbound;
    if (typeof publish === "function") {
      publish({
        channel: "xhs",
        sessionId: params.sessionId,
        shopId: params.shopId,
        content: params.content,
      });
    }
  });
  api.registerHttpRoute({
    path: XHS_WEBHOOK_PATH,
    handler: webhookHandler,
  });

  if (typeof api.registerTool === "function") {
    const tools = createXhsTools(getConfig);
    for (const tool of tools) api.registerTool(tool);
  }

  console.log(`[rednode] Plugin registered — channel xhs + ${XHS_WEBHOOK_PATH}`);
}
