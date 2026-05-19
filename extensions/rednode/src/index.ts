/**
 * @partme.ai/openclaw-rednode 插件入口
 *
 * 小红书开放平台渠道 + 运营工具，公域 Agent-First 智能运营。
 * 符合 partme-docs/6、OctoClaw/8、小红书开放平台对接规格.md
 *
 * - registerChannel(xhs)：渠道 xhs，配置 channels.xhs
 * - registerHttpRoute(/channels/xhs/webhook)：接收小红书事件回调
 * - registerTool：xhs_query_orders、xhs_query_order_detail、xhs_query_refunds、xhs_query_items、xhs_item_on_off_shelf
 */

import type { PluginApi } from "./types.js";
import { xhsChannel } from "./channel.js";
import { createXhsWebhookHandler } from "./callback.js";
import { createXhsTools } from "./tools.js";

function getXhsConfig(api: PluginApi): (() => import("./types.js").XhsAccountConfig | undefined) {
  return () => {
    const channels = api.runtime.config?.channels as Record<string, unknown> | undefined;
    const xhs = channels?.xhs as Record<string, unknown> | undefined;
    return xhs as import("./types.js").XhsAccountConfig | undefined;
  };
}

/**
 * 插件注册入口
 */
export default function register(api: PluginApi): void {
  api.registerChannel({ plugin: xhsChannel });

  const webhookHandler = createXhsWebhookHandler(getXhsConfig(api), (params) => {
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
    path: "/channels/xhs/webhook",
    handler: webhookHandler,
  });

  if (typeof api.registerTool === "function") {
    const tools = createXhsTools(getXhsConfig(api));
    for (const tool of tools) api.registerTool(tool);
  }

  console.log("[rednode] Plugin registered — channel xhs + /channels/xhs/webhook");
}
