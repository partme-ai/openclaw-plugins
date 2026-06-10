/**
 * @fileoverview RabbitMQ 通道运行时状态缓存。
 *
 * @description
 * 在 gateway 启动后缓存已解析的配置快照，供 inbound/outbound/transport 热路径读取，
 * 避免重复解析 openclaw.json。
 *
 * @module state/state
 */

import type { RabbitmqConfig } from "../config.js";

let rabbitmqChannelConfig: RabbitmqConfig | null = null;

/**
 * @description 在 gateway.startAccount 时写入当前 RabbitMQ 通道配置。
 * @param config - 已解析并校验的配置对象
 */
export function setRabbitmqChannelConfig(config: RabbitmqConfig): void {
  rabbitmqChannelConfig = config;
}

/**
 * @description 获取 gateway 生命周期内缓存的 RabbitMQ 配置；未启动时返回 null。
 * @returns 当前生效配置或 null
 */
export function getRabbitmqChannelConfig(): RabbitmqConfig | null {
  return rabbitmqChannelConfig;
}