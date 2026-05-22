/**
 * RabbitMQ 通道状态管理。
 */

import type { RabbitmqConfig } from "./config.js";

let rabbitmqChannelConfig: RabbitmqConfig | null = null;

/**
 * 设置 RabbitMQ 通道配置。
 */
export function setRabbitmqChannelConfig(config: RabbitmqConfig): void {
  rabbitmqChannelConfig = config;
}

/**
 * 获取 RabbitMQ 通道配置。
 */
export function getRabbitmqChannelConfig(): RabbitmqConfig | null {
  return rabbitmqChannelConfig;
}