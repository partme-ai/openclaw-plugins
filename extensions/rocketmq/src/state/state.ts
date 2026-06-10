/**
 * @fileoverview RocketMQ 通道运行时状态：缓存 gateway 启动后的生效配置。
 *
 * @description
 * outbound / inbound 在子进程或延迟加载场景需读取「当前账户已解析配置」；
 * `setRockermqChannelConfig` 在 `gateway.startAccount` 时写入进程内单例。
 *
 * @module state/state
 */

/**
 * RocketMQ 通道状态 — 进程内配置缓存。
 */

import type { RockermqConfig } from "../config.js";

let rockermqChannelConfig: RockermqConfig | null = null;

/**
 * @description 写入当前 RocketMQ 通道配置（`gateway.startAccount` 时调用）。
 * @param config - 经 `resolveRockermqConfig` 解析后的配置。
 * @returns void
 * @throws 不抛出。
 */
export function setRockermqChannelConfig(config: RockermqConfig): void {
  rockermqChannelConfig = config;
}

/**
 * @description 读取缓存的 RocketMQ 配置；Gateway 未启动该账户时返回 `null`。
 * @returns 当前配置或 `null`。
 * @throws 不抛出。
 */
export function getRockermqChannelConfig(): RockermqConfig | null {
  return rockermqChannelConfig;
}
