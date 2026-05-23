/**
 * 高德插件运行时存取。
 */

import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";

const { getRuntime: getAmapRuntime, setRuntime: setAmapRuntime } =
  createPluginRuntimeStore<PluginRuntime>("Amap plugin runtime not initialized");

export { getAmapRuntime, setAmapRuntime };

/** 插件运行时版本占位（兼容旧引用）。 */
export const AMAP_PLUGIN_RUNTIME_VERSION = 1;
