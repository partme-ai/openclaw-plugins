/**
 * Rednode 插件运行时存取。
 */

import type { PluginRuntime } from "openclaw/plugin-sdk/core";

let runtime: PluginRuntime | undefined;

/**
 * 注入 OpenClaw PluginRuntime（由 defineChannelPluginEntry 回调）。
 */
export function setRuntime(rt: PluginRuntime): void {
  runtime = rt;
}

/**
 * 获取已注入的运行时；未初始化时抛出。
 */
export function getRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("[rednode] Runtime not initialized");
  }
  return runtime;
}

/** 插件运行时版本占位（兼容旧引用）。 */
export const REDNODE_PLUGIN_RUNTIME_VERSION = 1;
