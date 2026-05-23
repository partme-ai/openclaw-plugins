/**
 * 从 runtime.config 与 pluginConfig 解析美团渠道配置。
 */

import type { MeituanAccountConfig, PluginApi } from "./types.js";

/**
 * 返回美团渠道配置 getter（含 pluginConfig 浅合并）。
 */
export function createMeituanConfigGetter(
  api: PluginApi,
): () => MeituanAccountConfig | undefined {
  return () => {
    const channels = api.runtime.config?.channels as Record<string, unknown> | undefined;
    const meituan = channels?.meituan as Record<string, unknown> | undefined;
    const base = meituan ?? {};
    const overlay = api.pluginConfig ?? {};
    return { ...base, ...overlay } as unknown as MeituanAccountConfig;
  };
}
