/**
 * @fileoverview RabbitMQ 插件 OpenClaw Runtime 引用存储。
 *
 * @description
 * 由 `defineChannelPluginEntry.setRuntime` 在插件注册阶段注入 Gateway 提供的
 * `PluginRuntime`，供 inbound 调用 Agent 分发管线与 resolveAgentRoute。
 *
 * @module runtime
 */

let runtime: any = null;

/**
 * @description 注入 Gateway 提供的 PluginRuntime。
 * @param runtimeInstance - OpenClaw 运行时实例
 */
export function setRabbitmqRuntime(runtimeInstance: any): void {
  runtime = runtimeInstance;
  console.log("[openclaw-rabbitmq] Runtime set");
}

/**
 * @description 获取已注入的 OpenClaw Runtime；未初始化时返回 null。
 * @returns PluginRuntime 或 null
 */
export function getRabbitmqRuntime(): any {
  return runtime;
}