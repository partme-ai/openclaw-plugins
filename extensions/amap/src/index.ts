/**
 * @partme.ai/openclaw-amap 插件入口
 *
 * 高德开放平台渠道 + 运营工具，公域 Agent-First 智能运营。
 * 符合 partme-docs/6、OctoClaw/3、公域平台-Agent-First-智能运营-设计文档.md
 *
 * - registerChannel(amap)：渠道 amap，配置 channels.amap
 * - registerHttpRoute(/channels/amap/webhook)：可选入站（高德当前无统一事件推送）
 * - registerTool：amap_query_poi、amap_query_around、amap_place_detail
 */

import type { PluginApi } from "./types.js";
import { amapChannel } from "./channel.js";
import { createAmapWebhookHandler } from "./callback.js";
import { createAmapTools } from "./tools.js";

function getAmapConfig(api: PluginApi): (() => import("./types.js").AmapAccountConfig | undefined) {
  return () => {
    const channels = api.runtime.config?.channels as Record<string, unknown> | undefined;
    const amap = channels?.amap as Record<string, unknown> | undefined;
    return amap as import("./types.js").AmapAccountConfig | undefined;
  };
}

/**
 * 插件注册入口
 */
export default function register(api: PluginApi): void {
  api.registerChannel({ plugin: amapChannel });

  const webhookHandler = createAmapWebhookHandler(getAmapConfig(api), (params) => {
    const publish = api.runtime?.channel?.publishInbound;
    if (typeof publish === "function") {
      publish({
        channel: "amap",
        sessionId: params.sessionId,
        shopId: params.shopId,
        content: params.content,
      });
    }
  });
  api.registerHttpRoute({
    path: "/channels/amap/webhook",
    handler: webhookHandler,
  });

  if (typeof api.registerTool === "function") {
    const tools = createAmapTools(getAmapConfig(api));
    for (const tool of tools) api.registerTool(tool);
  }

  console.log("[amap] Plugin registered — channel amap + /channels/amap/webhook");
}
