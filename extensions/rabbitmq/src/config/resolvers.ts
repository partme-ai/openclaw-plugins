/**
 * @module config/resolvers
 *
 * RabbitMQ 渠道级配置解析：委托 message-sdk，保留插件默认值。
 */

import {
  resolveChannelAgentReplyTimeoutMs,
  type ChannelLimitsOpenClawConfig,
} from "@partme.ai/openclaw-message-sdk/config";

import { DEFAULT_RABBITMQ_CONFIG } from "../config.js";

/** OpenClaw channels.rabbitmq 渠道 ID。 */
export const RABBITMQ_CHANNEL_ID = "rabbitmq";

/**
 * 解析 RabbitMQ Agent 回复超时（委托 message-sdk）。
 */
export function resolveRabbitmqAgentReplyTimeoutMs(
  cfg: ChannelLimitsOpenClawConfig,
  channelDefaultMs = DEFAULT_RABBITMQ_CONFIG.dispatch.timeoutMs,
): number {
  return resolveChannelAgentReplyTimeoutMs({
    channelId: RABBITMQ_CHANNEL_ID,
    cfg,
    defaultTimeoutMs: channelDefaultMs,
  });
}
