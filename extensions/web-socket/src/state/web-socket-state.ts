/**
 * @module web-socket/state/web-socket-state
 *
 * 进程内 WebSocket Channel 配置快照。
 */

import type { OpenClawDmScope, WebsocketChannelConfig } from "../types.js";

let channelConfig: WebsocketChannelConfig | null = null;
let policyVersion = 0;
let policyUpdatedAt: number | null = null;
let openClawDmScope: OpenClawDmScope = "per-peer";

/**
 * 设置 Channel 配置快照（gateway 启动时）。
 */
export function setWebsocketChannelConfig(
  next: WebsocketChannelConfig | null,
  dmScope: OpenClawDmScope = "per-peer",
): void {
  channelConfig = next;
  openClawDmScope = dmScope;
  policyVersion += 1;
  policyUpdatedAt = Date.now();
}

/**
 * 读取当前配置快照。
 */
export function getWebsocketChannelConfig(): WebsocketChannelConfig | null {
  return channelConfig;
}

/**
 * 策略元信息（/web-socket/status）。
 */
export function getWebsocketPolicyMeta(): {
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
