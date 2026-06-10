/**
 * @partme.ai/openclaw-amap 插件入口
 *
 * 高德开放平台渠道 + 运营工具，公域 Agent-First 智能运营。
 *
 * **架构角色**：OpenClaw Channel Plugin 的主入口，通过 `defineChannelPluginEntry` 完成：
 * - Channel 注册（元数据、配置解析、出站适配）
 * - HTTP Webhook 入站路由绑定
 * - Agent 可调用工具（POI / 周边 / 详情查询）
 *
 * **关键依赖**：
 * - `openclaw/plugin-sdk/core` — 插件定义、运行时注入
 * - `./channel` — 渠道定义体
 * - `./inbound` — Webhook 处理器工厂
 * - `./config` — 从 PluginApi 读取 channels.amap 配置
 * - `./tools/tools` — 高德 Web 服务 API 工具集
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

/** 高德渠道定义，供外部直接引用或测试挂载。 */
export { amapChannel } from "./channel.js";

/**
 * 高德 Channel Plugin 默认导出。
 *
 * `registerFull` 在 Gateway 启动时执行完整注册：Webhook 路由 + 可选工具。
 */
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

    // 宿主支持 registerTool 时注册 POI / 周边等运营工具
    if (typeof api.registerTool === "function") {
      const tools = createAmapTools(getConfig);
      for (const tool of tools) api.registerTool(tool as never);
    }

    console.log(`[amap] Plugin registered — channel amap + ${AMAP_WEBHOOK_PATH}`);
  },
});
