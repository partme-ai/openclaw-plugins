/**
 * 进程内 MQTT Channel 配置快照（由 gateway startAccount 在启动 broker 时写入）。
 */

import type { MqttChannelConfig } from "./types.js";
import type { OpenClawDmScope } from "./types.js";

let channelConfig: MqttChannelConfig | null = null;
let policyVersion = 0;
let policyUpdatedAt: number | null = null;
let openClawDmScope: OpenClawDmScope = "main";

/**
 * 设置当前生效的 `channels.mqtt` 解析结果。
 */
export function setMqttChannelConfig(next: MqttChannelConfig | null, dmScope: OpenClawDmScope = "main"): void {
  channelConfig = next;
  openClawDmScope = dmScope;
  policyVersion += 1;
  policyUpdatedAt = Date.now();
}

/**
 * 读取当前配置快照。
 */
export function getMqttChannelConfig(): MqttChannelConfig | null {
  return channelConfig;
}

/**
 * 获取策略快照元信息（用于热更新可观测）。
 */
export function getMqttPolicyMeta(): {
  version: number;
  updatedAt: number | null;
  loaded: boolean;
  openClawDmScope: OpenClawDmScope;
} {
  return {
    version: policyVersion,
    updatedAt: policyUpdatedAt,
    loaded: channelConfig !== null,
    openClawDmScope,
  };
}
