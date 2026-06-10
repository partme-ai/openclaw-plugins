/**
 * @fileoverview 缓存 OpenClaw PluginRuntime，供 WebSocket 入站与 HTTP 路由使用。
 *
 * @module web-socket/runtime
 */

import type { PluginRuntime } from "openclaw/plugin-sdk/core";

let runtime: PluginRuntime | null = null;

/**
 * 在插件 register 阶段注入 runtime。
 */
export function setWebsocketRuntime(next: PluginRuntime): void {
  runtime = next;
}

/**
 * 获取当前 runtime；未注册时返回 null。
 */
export function getWebsocketRuntime(): PluginRuntime | null {
  return runtime;
}
