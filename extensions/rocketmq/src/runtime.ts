/**
 * RocketMQ 插件运行时引用。
 */

let runtime: any = null;

/**
 * 设置 OpenClaw 运行时。
 */
export function setRockermqRuntime(runtimeInstance: any): void {
  runtime = runtimeInstance;
}

/**
 * 获取 OpenClaw 运行时。
 */
export function getRockermqRuntime(): any {
  return runtime;
}
