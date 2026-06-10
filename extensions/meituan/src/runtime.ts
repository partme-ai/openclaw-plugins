/**
 * 美团插件运行时存取模块。
 *
 * **架构角色**：OpenClaw 注入 `PluginRuntime` 后的全局 getter/setter，
 * 供 dispatch 与工具层访问 config / channel reply 能力。
 *
 * **关键依赖**：`openclaw/plugin-sdk/runtime-store`、`openclaw/plugin-sdk/core`
 */

import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";

const { getRuntime: getMeituanRuntime, setRuntime: setMeituanRuntime } =
  createPluginRuntimeStore<PluginRuntime>("Meituan plugin runtime not initialized");

/** 获取已注入的 PluginRuntime；未初始化时抛错 */
export { getMeituanRuntime, setMeituanRuntime };

/** 插件运行时版本占位（兼容旧引用）。 */
export const MEITUAN_PLUGIN_RUNTIME_VERSION = 1;
