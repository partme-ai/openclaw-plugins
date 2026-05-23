/**
 * 从 runtime.config 解析小红书 channels.xhs。
 */

import type { PluginApi, XhsAccountConfig } from "./types.js";

/**
 * 返回小红书账号配置 getter。
 */
export function createXhsConfigGetter(api: PluginApi): () => XhsAccountConfig | undefined {
  return () => {
    const channels = api.runtime.config?.channels as Record<string, unknown> | undefined;
    const xhs = channels?.xhs as Record<string, unknown> | undefined;
    return xhs as XhsAccountConfig | undefined;
  };
}
