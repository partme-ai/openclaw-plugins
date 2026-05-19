/**
 * 企微客服插件运行时注入
 * 与 wecom 插件 runtime 模式一致：register 时 set，回调/agent 内 get
 */

import type { GatewayRuntime } from "./types/index.js";

let runtime: GatewayRuntime | null = null;

/**
 * 设置企微客服插件运行时
 * 由插件 register 入口调用，供后续回调与 agent 内 getWecomKfRuntime 使用
 *
 * @param next - Gateway 注入的 runtime 实例
 */
export function setWecomKfRuntime(next: GatewayRuntime): void {
  runtime = next;
}

/**
 * 获取企微客服插件运行时
 * 供 config、agent/handler 等模块使用，未初始化时抛错
 *
 * @returns 当前插件运行时
 * @throws 未调用 setWecomKfRuntime 时抛出
 */
export function getWecomKfRuntime(): GatewayRuntime {
  if (!runtime) {
    throw new Error("[wecom_kf] WeCom KF runtime not initialized");
  }
  return runtime;
}
