/**
 * @module mqtt/state/mqtt-state
 *
 * 进程内 MQTT Channel 配置快照（由 gateway startAccount 在启动 broker 时写入）。
 */

import type { MqttChannelConfig } from "../types.js";
import type { OpenClawDmScope } from "../types.js";

let channelConfig: MqttChannelConfig | null = null;
let policyVersion = 0;
let policyUpdatedAt: number | null = null;
let openClawDmScope: OpenClawDmScope = "main";

/**
 * 设置当前 Channel 配置快照与 OpenClaw dmScope（broker 启动时调用）。
 *
 * @param next - 解析后的 `channels.mqtt`；null 表示卸载
 * @param dmScope - 全局 session.dmScope，默认 `main`
 */
export function setMqttChannelConfig(next: MqttChannelConfig | null, dmScope: OpenClawDmScope = "main"): void {
  channelConfig = next;
  openClawDmScope = dmScope;
  policyVersion += 1;
  policyUpdatedAt = Date.now();
}

/**
 * 读取当前 Channel 配置快照。
 *
 * @returns 最近一次 setMqttChannelConfig 写入的配置，或 null
 */
export function getMqttChannelConfig(): MqttChannelConfig | null {
  return channelConfig;
}

/**
 * 获取策略快照元信息（版本号、更新时间、是否已加载、dmScope）。
 *
 * @returns 用于 `/mqtt/status` 与热更新可观测的元数据
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
