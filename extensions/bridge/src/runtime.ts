/**
 * Bridge 插件运行时占位（hook 插件无 Channel runtime，保留 Base Profile 入口）。
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

let bridgeApi: OpenClawPluginApi | null = null;

/**
 * 在 register() 时注入 OpenClawPluginApi 引用。
 */
export function setBridgeRuntime(api: OpenClawPluginApi): void {
  bridgeApi = api;
}

/**
 * 获取已注入的 Bridge API；未注册时返回 null。
 */
export function getBridgeRuntime(): OpenClawPluginApi | null {
  return bridgeApi;
}
