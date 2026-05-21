/**
 * 缓存 OpenClaw PluginRuntime，供 MQTT broker 入站回调与 HTTP 路由使用。
 */

import type { PluginRuntime } from "openclaw/plugin-sdk/core";

let runtime: PluginRuntime | null = null;

/**
 * 在插件 register 阶段注入 Gateway 注入的 runtime。
 */
export function setMqttRuntime(next: PluginRuntime): void {
  runtime = next;
}

/**
 * 获取当前 runtime；若尚未注册则返回 null。
 */
export function getMqttRuntime(): PluginRuntime | null {
  return runtime;
}
