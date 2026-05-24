/**
 * @fileoverview Bridge 插件进程内单例：缓存 `OpenClawPluginApi`。
 *
 * @description
 * Bridge 作为 Hook 插件不暴露标准 Channel runtime；此处仅保留可注入的 API 句柄，
 * 供后续扩展（例如其他模块需读取 logger、配置）时复用，无需重复遍历宿主注册表。
 *
 * @module runtime
 */

/**
 * Bridge 插件运行时占位（hook 插件无 Channel runtime，保留 Base Profile 入口）。
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

let bridgeApi: OpenClawPluginApi | null = null;

/**
 * @description 在 `register()` 生命周期早期注入宿主 API 引用，供本包其他模块只读获取。
 * @param api - 当前插件实例绑定的 OpenClaw 插件 API。
 * @returns void
 * @throws 不抛出。
 */
export function setBridgeRuntime(api: OpenClawPluginApi): void {
  bridgeApi = api;
}

/**
 * @description 返回已存储的 API；若尚未调用 `setBridgeRuntime` 则返回 `null`。
 * @returns 已注入的 `OpenClawPluginApi`，或 `null`。
 * @throws 不抛出。
 */
export function getBridgeRuntime(): OpenClawPluginApi | null {
  return bridgeApi;
}
