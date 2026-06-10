/**
 * @partme.ai/openclaw-douyin — 抖音开放平台渠道插件入口。
 *
 * **架构角色**：OpenClaw 渠道插件的 `defineChannelPluginEntry` 注册点，将
 * `douyinChannelPlugin` 暴露给宿主，并在 full 模式下注册运营工具。
 *
 * **业务说明**：
 * - 配置来源：`openclaw.json` → `channels.douyin`（支持顶层 + `accounts.<id>` 多账号）
 * - 入站：Gateway 按账号注册 Webhook（`auth: plugin`），经 `inbound.ts` 验签后派发
 * - 出站：占位实现（直连 DM 需抖店/OpenAPI）
 *
 * **关键依赖**：`openclaw/plugin-sdk/core`、`./channel`、`./runtime`、`./tools/tools`
 */

import {
  defineChannelPluginEntry,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";
import { douyinChannelPlugin } from "./channel.js";
import { getDouyinRuntime, setDouyinRuntime } from "./runtime.js";
import type { DouyinAccountConfig } from "./types.js";
import { createDouyinTools } from "./tools/tools.js";

/** 重新导出渠道插件与 runtime setter，供宿主或测试直接 import */
export { douyinChannelPlugin } from "./channel.js";
export { setDouyinRuntime, getDouyinRuntime } from "./runtime.js";

/**
 * 创建配置读取闭包，供 `createDouyinTools` 在 execute 时懒加载渠道凭据。
 *
 * @returns 无参 getter；运行时未初始化或配置缺失时返回 `undefined`
 */
function createGetDouyinSectionConfig(): () => DouyinAccountConfig | undefined {
  return () => {
    const rt = getDouyinRuntime();
    const cfg = rt.config.loadConfig();
    const channels = cfg.channels as Record<string, unknown> | undefined;
    return (channels?.douyin ?? undefined) as DouyinAccountConfig | undefined;
  };
}

export default defineChannelPluginEntry({
  id: "douyin",
  name: "抖音",
  description: "抖音开放平台 Webhook 渠道与运营工具",
  plugin: douyinChannelPlugin,
  setRuntime: setDouyinRuntime,
  registerFull(api: OpenClawPluginApi) {
    const getConfig = createGetDouyinSectionConfig();
    for (const tool of createDouyinTools(getConfig)) {
      api.registerTool(tool as never);
    }
  },
});
