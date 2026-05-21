/**
 * 插件运行时存根，供 Webhook 与 Gateway 在注册后访问 PluginRuntime。
 */
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";

const { getRuntime: getDouyinRuntime, setRuntime: setDouyinRuntime } =
  createPluginRuntimeStore<PluginRuntime>("Douyin plugin runtime not initialized");

export { getDouyinRuntime, setDouyinRuntime };
