/**
 * @module config/resolvers
 *
 * RocketMQ 渠道级配置解析：委托 message-sdk，保留插件默认值。
 */

import {
  resolveChannelAgentReplyTimeoutMs,
  type ChannelLimitsOpenClawConfig,
} from "@partme.ai/openclaw-message-sdk/config";

import { DEFAULT_ROCKERMQ_CONFIG } from "../config.js";

/** OpenClaw channels.rocketmq 渠道 ID。 */
export const ROCKETMQ_CHANNEL_ID = "rocketmq";

/**
 * 解析 RocketMQ Agent 回复超时（委托 message-sdk）。
 */
export function resolveRocketmqAgentReplyTimeoutMs(
  cfg: ChannelLimitsOpenClawConfig,
  channelDefaultMs = DEFAULT_ROCKERMQ_CONFIG.dispatch.timeoutMs,
): number {
  return resolveChannelAgentReplyTimeoutMs({
    channelId: ROCKETMQ_CHANNEL_ID,
    cfg,
    defaultTimeoutMs: channelDefaultMs,
  });
}
