/**
 * runtime 存储。
 * 使用模块私有引用提供同步 get/set 语义，避免 Node 24 并行加载插件时
 * `runtime-store` ESM 子路径发生 require/import 竞态。
 */

import type { PluginRuntime } from "openclaw/plugin-sdk/core";

let currentRuntime: PluginRuntime | null = null;

/**
 * 注入 OpenClaw PluginRuntime 到 web-mqtt 模块级 store。
 *
 * @param runtime - Gateway 注入的 PluginRuntime 实例
 * @returns void
 */
export function setWebMqttRuntime(runtime: PluginRuntime): void {
  currentRuntime = runtime;
}

/**
 * 获取 runtime；若未初始化返回 null。
 *
 * @returns PluginRuntime 或 null
 */
export function tryGetWebMqttRuntime(): PluginRuntime | null {
  return currentRuntime;
}

/**
 * 必须获取 runtime；未初始化时抛错。
 *
 * @returns 已注入的 PluginRuntime
 * @throws 当 runtime 尚未 set 时
 */
export function getWebMqttRuntime(): PluginRuntime {
  if (!currentRuntime) {
    throw new Error("openclaw-web-mqtt runtime not initialized");
  }
  return currentRuntime;
}
