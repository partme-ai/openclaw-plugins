/**
 * 美团插件运行时存取。
 */

import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";

const { getRuntime: getMeituanRuntime, setRuntime: setMeituanRuntime } =
  createPluginRuntimeStore<PluginRuntime>("Meituan plugin runtime not initialized");

export { getMeituanRuntime, setMeituanRuntime };

/** 插件运行时版本占位（兼容旧引用）。 */
export const MEITUAN_PLUGIN_RUNTIME_VERSION = 1;
