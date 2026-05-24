/**
 * WeChat iPad 插件运行时引用缓存。
 */

import type { GatewayRuntime, WechatIpadConfig } from "./types.js";

/** Gateway Runtime 引用（消息管道调度） */
let _runtime: GatewayRuntime | null = null;

/** 当前解析后的插件配置 */
let _resolvedConfig: WechatIpadConfig | null = null;

/**
 * 注入 OpenClaw Gateway Runtime。
 *
 * @param runtime - Gateway 注入的运行时实例
 */
export function setWechatIpadRuntime(runtime: GatewayRuntime): void {
  _runtime = runtime;
}

/**
 * 获取已注入的 Gateway Runtime。
 *
 * @returns 运行时引用；未注册时为 null
 */
export function getWechatIpadRuntime(): GatewayRuntime | null {
  return _runtime;
}

/**
 * 缓存解析后的插件配置。
 *
 * @param config - 合并默认值的插件配置
 */
export function setResolvedWechatIpadConfig(config: WechatIpadConfig): void {
  _resolvedConfig = config;
}

/**
 * 读取最近一次解析的插件配置。
 *
 * @returns 插件配置；未解析时为 null
 */
export function getResolvedWechatIpadConfig(): WechatIpadConfig | null {
  return _resolvedConfig;
}
