/**
 * 运行时管理。
 * 负责管理插件的运行时状态和配置。
 */

let runtime: any = null;

/**
 * 设置运行时。
 */
export function setRabbitmqRuntime(runtimeInstance: any): void {
  runtime = runtimeInstance;
  console.log("[openclaw-rabbitmq] Runtime set");
}

/**
 * 获取运行时。
 */
export function getRabbitmqRuntime(): any {
  return runtime;
}