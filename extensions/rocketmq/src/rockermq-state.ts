/**
 * RocketMQ 通道状态。
 */

import type { RockermqConfig } from "./rockermq-config.js";

let rockermqChannelConfig: RockermqConfig | null = null;

/**
 * 保存当前生效配置。
 */
export function setRockermqChannelConfig(config: RockermqConfig): void {
  rockermqChannelConfig = config;
}

/**
 * 获取当前生效配置。
 */
export function getRockermqChannelConfig(): RockermqConfig | null {
  return rockermqChannelConfig;
}
