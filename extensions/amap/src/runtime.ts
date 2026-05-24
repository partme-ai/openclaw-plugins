/**
 * 高德插件运行时存取（Runtime Store）
 *
 * **架构角色**：通过 OpenClaw 插件 SDK 的 `createPluginRuntimeStore` 持有
 * Gateway 注入的 `PluginRuntime`，供入站派发、工具调用等模块按需读取。
 *
 * **关键依赖**：`openclaw/plugin-sdk/core`、`openclaw/plugin-sdk/runtime-store`
 */

import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";

const { getRuntime: getAmapRuntime, setRuntime: setAmapRuntime } =
  createPluginRuntimeStore<PluginRuntime>("Amap plugin runtime not initialized");

/** 获取已注入的高德插件运行时；未初始化时抛出错误。 */
export { getAmapRuntime, setAmapRuntime };

/** 插件运行时版本占位，用于兼容旧版引用与迁移检测。 */
export const AMAP_PLUGIN_RUNTIME_VERSION = 1;
