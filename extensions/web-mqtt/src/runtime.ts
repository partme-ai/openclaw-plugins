/**
 * runtime 存储。
 * 使用 SDK runtime-store 提供统一 get/set 语义，避免手工全局变量引发时序问题。
 */

import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
import type { PluginRuntime } from "openclaw/plugin-sdk/runtime-store";

const runtimeStore = createPluginRuntimeStore<PluginRuntime>("openclaw-web-mqtt runtime not initialized");

/**
 * 注入 OpenClaw PluginRuntime 到 web-mqtt 模块级 store。
 *
 * @param runtime - Gateway 注入的 PluginRuntime 实例
 * @returns void
 */
export function setWebMqttRuntime(runtime: PluginRuntime): void {
  runtimeStore.setRuntime(runtime);
}

/**
 * 获取 runtime；若未初始化返回 null。
 *
 * @returns PluginRuntime 或 null
 */
export function tryGetWebMqttRuntime(): PluginRuntime | null {
  return runtimeStore.tryGetRuntime();
}

/**
 * 必须获取 runtime；未初始化时抛错。
 *
 * @returns 已注入的 PluginRuntime
 * @throws 当 runtime 尚未 set 时
 */
export function getWebMqttRuntime(): PluginRuntime {
  return runtimeStore.getRuntime();
}
