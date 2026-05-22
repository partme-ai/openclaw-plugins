/**
 * @partme.ai/openclaw-meituan 插件入口
 */

import type { PluginApi } from "./types.js";
import { meituanChannel } from "./channel.js";
import { createMeituanConfigGetter } from "./config.js";
import { createMeituanWebhookHandler } from "./inbound.js";
import { createMeituanTools } from "./tools.js";
import { MEITUAN_WEBHOOK_PATH } from "./transport/server.js";

function log(api: PluginApi, level: "info" | "warn" | "error", msg: string, ...args: unknown[]): void {
  const fn = api.logger?.[level];
  if (typeof fn === "function") fn(msg, ...args);
  else if (level === "info") console.log(msg, ...args);
  else if (level === "warn") console.warn(msg, ...args);
  else console.error(msg, ...args);
}

/**
 * 插件注册入口
 */
export default function register(api: PluginApi): void {
  api.registerChannel({ plugin: meituanChannel });

  const getConfig = createMeituanConfigGetter(api);

  const webhookHandler = createMeituanWebhookHandler(getConfig, api, api.logger);
  api.registerHttpRoute({
    path: MEITUAN_WEBHOOK_PATH,
    handler: webhookHandler,
  });

  if (typeof api.registerTool === "function") {
    const tools = createMeituanTools(getConfig);
    for (const tool of tools) api.registerTool(tool);
  }

  log(api, "info", `[meituan] Plugin registered — channel meituan + ${MEITUAN_WEBHOOK_PATH}`);
}
