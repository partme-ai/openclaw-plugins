/**
 * 从 PluginApi 注入的配置解析高德 channels.amap。
 */

import type { AmapAccountConfig, PluginApi } from "./types.js";

/**
 * 返回读取当前高德账号配置的 getter（供 Webhook / 工具注册复用）。
 */
export function createAmapConfigGetter(
  api: PluginApi,
): () => AmapAccountConfig | undefined {
  return () => {
    const channels = api.runtime.config?.channels as Record<string, unknown> | undefined;
    const amap = channels?.amap as Record<string, unknown> | undefined;
    return amap as AmapAccountConfig | undefined;
  };
}
