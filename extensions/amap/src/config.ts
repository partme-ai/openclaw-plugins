/**
 * 高德渠道配置解析（Config Adapter）
 *
 * **架构角色**：从 OpenClaw `PluginApi.runtime.config` 中提取 `channels.amap` 节，
 * 供 Webhook 入站、Agent 工具等同一份配置源复用。
 *
 * **关键依赖**：`./types` — `AmapAccountConfig`、`PluginApi`
 */

import type { AmapAccountConfig, PluginApi } from "./types.js";

/**
 * 创建读取当前高德账号配置的 getter。
 *
 * 配置路径：`runtime.config.channels.amap`（与《高德开放平台对接规格》一致）。
 *
 * @param api - OpenClaw 插件 API，含 runtime.config
 * @returns 无参函数；调用时返回 `AmapAccountConfig` 或 `undefined`（未配置 channels.amap）
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
