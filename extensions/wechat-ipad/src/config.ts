/**
 * WeChat iPad 插件配置解析。
 */

import { DEFAULT_CONFIG, type WechatIpadConfig } from "./types.js";

/**
 * 从 OpenClaw 全局配置中解析插件配置。
 * 合并默认配置和用户自定义配置。
 *
 * @param globalConfig - OpenClaw 全局配置
 * @returns 合并后的插件配置
 */
export function resolveWechatIpadConfig(
  globalConfig: Record<string, unknown>,
): WechatIpadConfig {
  const channels = globalConfig.channels as Record<string, unknown> | undefined;
  const raw = channels?.["wechat-ipad"] as Partial<WechatIpadConfig> | undefined;

  if (!raw) return { ...DEFAULT_CONFIG };

  return {
    serviceUrl: raw.serviceUrl ?? DEFAULT_CONFIG.serviceUrl,
    apiUrl: raw.apiUrl ?? DEFAULT_CONFIG.apiUrl,
    reconnect: {
      enabled: raw.reconnect?.enabled ?? DEFAULT_CONFIG.reconnect.enabled,
      intervalMs: raw.reconnect?.intervalMs ?? DEFAULT_CONFIG.reconnect.intervalMs,
      maxRetries: raw.reconnect?.maxRetries ?? DEFAULT_CONFIG.reconnect.maxRetries,
    },
    auth: {
      token: raw.auth?.token ?? DEFAULT_CONFIG.auth.token,
    },
    message: {
      handleGroup: raw.message?.handleGroup ?? DEFAULT_CONFIG.message.handleGroup,
      groupWhitelist: raw.message?.groupWhitelist ?? DEFAULT_CONFIG.message.groupWhitelist,
      ignoreself: raw.message?.ignoreself ?? DEFAULT_CONFIG.message.ignoreself,
    },
  };
}
