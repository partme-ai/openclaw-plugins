/**
 * @partme.ai/openclaw-meituan — 美团开放平台渠道插件入口。
 *
 * **架构角色**：OpenClaw 渠道插件的 `defineChannelPluginEntry` 注册点；
 * full 模式下注册 Webhook 路由、运营工具，并绑定 PluginRuntime。
 *
 * **业务说明**：
 * - 配置来源：`channels.meituan` + 可选 `pluginConfig` 浅合并
 * - 入站：`POST /channels/meituan/webhook`，HMAC 验签后经 dispatch 派发
 * - 出站：占位 sendText（平台侧 OpenAPI 推送）
 *
 * **关键依赖**：`openclaw/plugin-sdk/core`、`./channel`、`./inbound`、`./tools/tools`
 */

import {
  defineChannelPluginEntry,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";

import { meituanChannel } from "./channel.js";
import { createMeituanConfigGetter } from "./config.js";
import { createMeituanWebhookHandler } from "./inbound.js";
import { setMeituanRuntime } from "./runtime.js";
import { createMeituanTools } from "./tools/tools.js";
import { MEITUAN_WEBHOOK_PATH } from "./transport/server.js";
import type { PluginApi } from "./types.js";

/** 重新导出渠道定义，供 setup-entry 或测试引用 */
export { meituanChannel } from "./channel.js";

/** 统一日志输出：优先 api.logger，回退 console */
function log(api: PluginApi, level: "info" | "warn" | "error", msg: string, ...args: unknown[]): void {
  const fn = api.logger?.[level];
  if (typeof fn === "function") fn(msg, ...args);
  else if (level === "info") console.log(msg, ...args);
  else if (level === "warn") console.warn(msg, ...args);
  else console.error(msg, ...args);
}

export default defineChannelPluginEntry({
  id: "meituan",
  name: "美团",
  description: "美团开放平台渠道与运营工具 - 公域 Agent-First 智能运营",
  plugin: meituanChannel as never,
  setRuntime: setMeituanRuntime,
  registerFull(api: OpenClawPluginApi) {
    const pluginApi = api as never as PluginApi;
    const getConfig = createMeituanConfigGetter(pluginApi);

    const webhookHandler = createMeituanWebhookHandler(getConfig, pluginApi, pluginApi.logger);
    api.registerHttpRoute({
      path: MEITUAN_WEBHOOK_PATH,
      auth: "plugin",
      handler: webhookHandler,
    });

    if (typeof api.registerTool === "function") {
      const tools = createMeituanTools(getConfig);
      for (const tool of tools) api.registerTool(tool as never);
    }

    log(pluginApi, "info", `[meituan] Plugin registered — channel meituan + ${MEITUAN_WEBHOOK_PATH}`);
  },
});
