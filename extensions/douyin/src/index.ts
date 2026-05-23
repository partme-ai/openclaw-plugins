/**
 * @partme.ai/openclaw-douyin — 抖音开放平台渠道（官方 defineChannelPluginEntry）
 *
 * - channels.douyin 多账号 / 混合配置
 * - Gateway 按账号注册 Webhook（auth: plugin）并入站派发
 */

import {
  defineChannelPluginEntry,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";
import { douyinChannelPlugin } from "./channel.js";
import { getDouyinRuntime, setDouyinRuntime } from "./runtime.js";
import type { DouyinAccountConfig } from "./types.js";
import { createDouyinTools } from "./tools/tools.js";

export { douyinChannelPlugin } from "./channel.js";
export { setDouyinRuntime, getDouyinRuntime } from "./runtime.js";

/**
 * 从当前 PluginRuntime 读取 channels.douyin 供工具注册使用。
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
