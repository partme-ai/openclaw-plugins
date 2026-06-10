/**
 * @fileoverview Rednode 配置读取：从 runtime.config 解析 channels.xhs。
 *
 * @description
 * 提供闭包式 `createXhsConfigGetter`，供 Webhook handler 与 tools 在请求时读取最新账号配置。
 *
 * @module config
 */

/**
 * Rednode 配置 — Base Profile 入口。
 */

import type { PluginApi, XhsAccountConfig } from "./types.js";

/**
 * @description 返回小红书账号配置 getter（读取 `channels.xhs`）。
 * @param api - 插件 API（含 runtime.config）。
 * @returns 无参函数，调用时返回 `XhsAccountConfig` 或 `undefined`。
 * @throws 不抛出。
 */
export function createXhsConfigGetter(api: PluginApi): () => XhsAccountConfig | undefined {
  return () => {
    const channels = api.runtime.config?.channels as Record<string, unknown> | undefined;
    const xhs = channels?.xhs as Record<string, unknown> | undefined;
    return xhs as XhsAccountConfig | undefined;
  };
}
