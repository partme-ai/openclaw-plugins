/**
 * @fileoverview RocketMQ 插件进程内单例：缓存 `OpenClawPluginApi` / PluginRuntime。
 *
 * @description
 * inbound / outbound 与 message-sdk 桥接需访问宿主 routing、reply 等能力；
 * 此处保留可注入的 Runtime 句柄，避免 transport 层与 Channel 定义循环依赖。
 *
 * @module runtime
 */

/**
 * RocketMQ 插件 Runtime 占位（由 defineChannelPluginEntry.setRuntime 注入）。
 */

let runtime: any = null;

/**
 * @description 在插件注册生命周期早期注入宿主 Runtime 引用。
 * @param runtimeInstance - Gateway 注入的 OpenClaw PluginRuntime。
 * @returns void
 * @throws 不抛出。
 */
export function setRockermqRuntime(runtimeInstance: any): void {
  runtime = runtimeInstance;
}

/**
 * @description 返回已存储的 Runtime；若尚未调用 `setRockermqRuntime` 则返回 `null`。
 * @returns 已注入的 PluginRuntime，或 `null`。
 * @throws 不抛出。
 */
export function getRockermqRuntime(): any {
  return runtime;
}
