/**
 * 运行时状态快照。
 * 保存当前生效的配置快照，供 status 路由和诊断输出使用。
 */

import type { WebMqttConfig } from "../types.js";

let currentConfig: WebMqttConfig | null = null;

/**
 * 更新配置快照。
 */
export function setWebMqttChannelConfig(config: WebMqttConfig): void {
  currentConfig = config;
}

/**
 * 读取配置快照。
 */
export function getWebMqttChannelConfig(): WebMqttConfig | null {
  return currentConfig;
}
