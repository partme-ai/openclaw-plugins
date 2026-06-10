/**
 * @module config/resolvers
 *
 * STOMP TCP 渠道级配置解析：委托 message-sdk，保留插件默认值。
 */

import {
  resolveChannelAgentReplyTimeoutMs,
  resolveChannelMediaMaxBytes,
  type ChannelLimitsOpenClawConfig,
} from "@partme.ai/openclaw-message-sdk/config";

/** OpenClaw channels.stomp-tcp 渠道 ID。 */
export const STOMP_TCP_CHANNEL_ID = "stomp-tcp";

/** 默认 Agent 回复超时（供 embedded/subagent 扩展）。 */
export const DEFAULT_STOMP_TCP_AGENT_REPLY_TIMEOUT_MS = 120_000;

/** 默认 STOMP 媒体/载荷上限（与 maxFrameSize 独立配置项）。 */
export const DEFAULT_STOMP_TCP_MEDIA_MAX_BYTES = 80 * 1024 * 1024;

/**
 * 解析 STOMP TCP Agent 回复超时（委托 message-sdk）。
 */
export function resolveStompTcpAgentReplyTimeoutMs(
  cfg: ChannelLimitsOpenClawConfig,
  channelDefaultMs = DEFAULT_STOMP_TCP_AGENT_REPLY_TIMEOUT_MS,
): number {
  return resolveChannelAgentReplyTimeoutMs({
    channelId: STOMP_TCP_CHANNEL_ID,
    cfg,
    defaultTimeoutMs: channelDefaultMs,
  });
}

/**
 * 解析 STOMP TCP 媒体最大字节数（委托 message-sdk）。
 */
export function resolveStompTcpMediaMaxBytes(
  cfg: ChannelLimitsOpenClawConfig,
  channelDefaultBytes = DEFAULT_STOMP_TCP_MEDIA_MAX_BYTES,
): number {
  return resolveChannelMediaMaxBytes({
    channelId: STOMP_TCP_CHANNEL_ID,
    cfg,
    channelDefaultBytes,
  });
}
