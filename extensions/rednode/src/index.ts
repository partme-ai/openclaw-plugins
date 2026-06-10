/**
 * @fileoverview OpenClaw Rednode 插件聚合导出面（小红书 Channel 入口）。
 *
 * @description
 * 注册 xhs Channel、注入 Runtime、挂载 Webhook HTTP 路由，并可选注册运营 tools。
 * 与《小红书开放平台对接规格》channels.xhs 配置对齐。
 *
 * @module index
 */

/**
 * @partme.ai/openclaw-rednode — 小红书渠道与运营工具插件。
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

/** @description Rednode 插件 defineChannelPluginEntry 注册入口。 */
export default defineChannelPluginEntry({
  id: "rednode",
  name: "Rednode",
  description: "小红书开放平台渠道与运营工具 — 公域 Agent-First 智能运营",
  plugin: xhsChannel as never,
  setRuntime,
  /**
   * @description 注册 Webhook 路由与可选 Agent tools。
   * @param api - OpenClaw 插件 API。
   * @returns void
   */
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
