/**
 * @partme.ai/openclaw-meituan 插件入口
 *
 * 美团开放平台渠道 + 运营工具，公域 Agent-First 智能运营。
 * 符合 partme-docs/6、OctoClaw/3、公域平台-Agent-First-智能运营-设计文档.md
 *
 * - registerChannel(meituan)：渠道 meituan，配置 channels.meituan
 * - registerHttpRoute(/channels/meituan/webhook)：接收美团事件回调
 * - registerTool：meituan_query_orders、meituan_reply_review、meituan_query_shop_metrics（若 API 提供）
 */

import type { PluginApi } from "./types.js";
import { meituanChannel } from "./channel.js";
import { createMeituanWebhookHandler } from "./callback.js";
import { createMeituanTools } from "./tools.js";

/** 从 runtime.config.channels.meituan 取主配置，并用 api.pluginConfig 做浅合并覆盖（借鉴 zeroclaw plugin_config） */
function getMeituanConfig(api: PluginApi): (() => import("./types.js").MeituanAccountConfig | undefined) {
  return () => {
    const channels = api.runtime.config?.channels as Record<string, unknown> | undefined;
    const meituan = channels?.meituan as Record<string, unknown> | undefined;
    const base = meituan ?? {};
    const overlay = api.pluginConfig ?? {};
    return { ...base, ...overlay } as unknown as import("./types.js").MeituanAccountConfig;
  };
}

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

  const webhookHandler = createMeituanWebhookHandler(getMeituanConfig(api), (params) => {
    const publish = api.runtime?.channel?.publishInbound;
    if (typeof publish === "function") {
      publish({
        channel: "meituan",
        sessionId: params.sessionId,
        shopId: params.shopId,
        content: params.content,
      });
    }
  }, api.logger);
  api.registerHttpRoute({
    path: "/channels/meituan/webhook",
    handler: webhookHandler,
  });

  if (typeof api.registerTool === "function") {
    const tools = createMeituanTools(getMeituanConfig(api));
    for (const tool of tools) api.registerTool(tool);
  }

  log(api, "info", "[meituan] Plugin registered — channel meituan + /channels/meituan/webhook");
}
