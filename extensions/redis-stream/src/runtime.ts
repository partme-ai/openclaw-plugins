/**
 * @fileoverview Redis Stream 插件 OpenClaw Runtime 引用存储。
 *
 * @description
 * 在插件 `register` / `setRuntime` 阶段注入 Gateway 提供的 `PluginRuntime`，
 * 供 inbound 分发与 HTTP 状态路由读取宿主能力。
 *
 * @module runtime
 */

import type { PluginRuntime } from "openclaw/plugin-sdk/core";

let runtime: PluginRuntime | null = null;

/**
 * @description 在插件 register 阶段注入 Gateway 提供的 runtime。
 * @param next - OpenClaw PluginRuntime 实例
 */
export function setRedisStreamRuntime(next: PluginRuntime): void {
  runtime = next;
}

/**
 * @description 获取当前已注入的 runtime；若尚未注册则返回 null。
 * @returns PluginRuntime 或 null
 */
export function getRedisStreamRuntime(): PluginRuntime | null {
  return runtime;
}
