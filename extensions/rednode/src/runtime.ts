/**
 * @fileoverview Rednode 插件进程内单例：缓存 `PluginRuntime`。
 *
 * @description
 * dispatch、tools 等模块需访问宿主 routing / reply 能力；此处保留可注入 Runtime，
 * 由 `defineChannelPluginEntry.setRuntime` 在注册期写入。
 *
 * @module runtime
 */

/**
 * Rednode 插件 Runtime — Base Profile 入口。
 */

import type { PluginRuntime } from "openclaw/plugin-sdk/core";

let runtime: PluginRuntime | undefined;

/**
 * @description 注入 OpenClaw PluginRuntime。
 * @param rt - Gateway 运行时实例。
 * @returns void
 * @throws 不抛出。
 */
export function setRuntime(rt: PluginRuntime): void {
  runtime = rt;
}

/**
 * @description 获取已注入的运行时；未初始化时抛出明确错误。
 * @returns 已注入的 `PluginRuntime`。
 * @throws 未调用 `setRuntime` 时抛出 Error。
 */
export function getRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("[rednode] Runtime not initialized");
  }
  return runtime;
}

/** @description 插件运行时版本占位（兼容旧引用）。 */
export const REDNODE_PLUGIN_RUNTIME_VERSION = 1;
