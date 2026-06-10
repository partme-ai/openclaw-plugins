/**
 * @module config/resolvers
 *
 * Redis Stream 渠道级配置解析：委托 message-sdk，保留插件默认值。
 */

import {
  resolveChannelAgentReplyTimeoutMs,
  type ChannelLimitsOpenClawConfig,
} from "@partme.ai/openclaw-message-sdk/config";

/** OpenClaw channels.redis-stream 渠道 ID。 */
export const REDIS_STREAM_CHANNEL_ID = "redis-stream";

/** 默认 Agent 回复超时。 */
export const DEFAULT_REDIS_STREAM_AGENT_REPLY_TIMEOUT_MS = 120_000;

/**
 * 解析 Redis Stream Agent 回复超时（委托 message-sdk）。
 */
export function resolveRedisStreamAgentReplyTimeoutMs(
  cfg: ChannelLimitsOpenClawConfig,
  channelDefaultMs = DEFAULT_REDIS_STREAM_AGENT_REPLY_TIMEOUT_MS,
): number {
  return resolveChannelAgentReplyTimeoutMs({
    channelId: REDIS_STREAM_CHANNEL_ID,
    cfg,
    defaultTimeoutMs: channelDefaultMs,
  });
}
