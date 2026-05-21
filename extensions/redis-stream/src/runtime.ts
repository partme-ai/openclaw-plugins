/**
 * 缓存 OpenClaw PluginRuntime，供 Redis 入站回调与 HTTP 路由使用。
 *
 * 与 openclaw-mqtt / openclaw-rabbitmq 模式一致。
 */

import type { PluginRuntime } from "openclaw/plugin-sdk/core";

let runtime: PluginRuntime | null = null;

/**
 * 在插件 register 阶段注入 Gateway 提供的 runtime。
 */
export function setRedisStreamRuntime(next: PluginRuntime): void {
  runtime = next;
}

/**
 * 获取当前 runtime；若尚未注册则返回 null。
 */
export function getRedisStreamRuntime(): PluginRuntime | null {
  return runtime;
}
