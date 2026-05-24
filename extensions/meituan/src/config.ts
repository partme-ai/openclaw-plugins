/**
 * 美团渠道配置读取模块。
 *
 * **架构角色**：从 `api.runtime.config.channels.meituan` 与 `pluginConfig` 浅合并，
 * 产出工具与 Webhook 使用的 `MeituanAccountConfig`。
 *
 * **关键依赖**：`./types`
 */

import type { MeituanAccountConfig, PluginApi } from "./types.js";

/**
 * 创建美团渠道配置 getter（含 pluginConfig 浅合并）。
 *
 * @param api OpenClaw 注入的插件 API
 * @returns 无参函数；每次调用返回最新合并后的渠道配置或 undefined
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
